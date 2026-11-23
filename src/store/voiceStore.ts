import { create } from 'zustand'
import { api } from '@/lib/api'
import { startLive, type LiveTranscript } from '@/lib/voice/liveTranscript'
import { hearLocally, loadLocalSpeech } from '@/lib/voice/localSpeech'
import { SAMPLE_RATE, listen } from '@/lib/voice/microphone'
import { commandFrom, matchWake, mightBeWake } from '@/lib/wake'
import { encodeWav, joinSamples, toBase64, trimLeadingQuiet } from '@/lib/wav'
import { useStore } from './index'

/**
 * off:      not listening; the microphone is closed.
 * starting: loading the speech model and opening the microphone.
 * waiting:  listening for the wake phrase ("Hey Seven of Nine"). Nothing heard in this state leaves the machine.
 * away:     switched on, but Quarry is not the window in front, so the microphone is closed.
 * hearing:  the wake phrase was said; what is being said now, or next, is the request.
 * working:  the request is finished and has gone to Ask.
 */
export type VoicePhase = 'off' | 'starting' | 'waiting' | 'away' | 'hearing' | 'working'

/** After the wake phrase on its own, how long to wait for the request before giving up. */
const FOLLOW_UP_MS = 8000
/** How much of a stretch of speech the on-device model is given: enough to hold the wake phrase. */
const WAKE_WINDOW = SAMPLE_RATE * 3
/** Speech shorter than this after the wake phrase is taken as the phrase alone. */
const PHRASE_ONLY = SAMPLE_RATE * 1.8
/** Sound kept from just before speech is noticed, so the first syllable is not clipped. */
const PRE_ROLL = SAMPLE_RATE * 0.25
/** While someone is still talking, the wake phrase is looked for this far in, and again at each step after. */
const FIRST_CHECK = SAMPLE_RATE * 1.0
const CHECK_STEP = SAMPLE_RATE * 0.4
/** Silence added after speech that is cut off part-way; the on-device model hears a clip that ends mid-word badly. */
const CUT_PADDING = SAMPLE_RATE * 0.5
/** The size of the pieces recorded speech is fed in, matching the microphone's. */
const PIECE = 512
const REMEMBER_KEY = 'quarry.voice.on'

interface VoiceState {
  phase: VoicePhase
  /** Whether a Deepgram key is set on the server. Null until asked. */
  configured: boolean | null
  /** The request so far, while it is being said. */
  heard: string
  /** The last request, as it was written down. */
  lastRequest: string
  /** What the on-device model made of the last thing said while waiting for the phrase. It explains a missed wake. */
  lastLocal: string
  error: string
  init: () => Promise<void>
  toggle: () => void
  start: () => Promise<void>
  /** Starts listening if it was on the last time Quarry was open. */
  resume: () => void
  /** `forget` false leaves the choice remembered, for when listening stops for a reason other than the user. */
  stop: (forget?: boolean) => void
  /** Recorded speech, fed through at the speed it was spoken, as if from the microphone. For checking it end to end. */
  hear: (samples: Float32Array) => Promise<void>
}

let stopListening: (() => void) | undefined
let followUp: ReturnType<typeof setTimeout> | undefined
/** The last moments of sound while nobody is speaking. */
let recent: Float32Array[] = []
let recentLength = 0
/** The stretch of speech in progress, in pieces. */
let stretch: Float32Array[] | null = null
let stretchLength = 0
/** Changes with every stretch, so a late answer about an old one is not acted on. */
let stretchId = 0
let nextCheck = FIRST_CHECK
let checking = false
let live: LiveTranscript | null = null
/** The request being heard has to start with the wake phrase; false once the phrase has been said on its own. */
let phraseDue = true
/** Ask was closed when the wake phrase was heard, so it is closed again if the wake turns out to be false. */
let openedAsk = false
/** Recorded speech is being fed in, so the microphone is not mixed into it. */
let feeding = false
/** The accurate transcript of the wake phrase is on its way; the person may already be saying the request. */
let confirming = false
/** A stretch of speech that started and ended while the phrase was being confirmed. */
let meanwhile: Float32Array | null = null

const remember = (on: boolean) => { try { localStorage.setItem(REMEMBER_KEY, on ? '1' : '0') } catch { /* private mode: just not remembered */ } }
const remembered = () => { try { return localStorage.getItem(REMEMBER_KEY) === '1' } catch { return false } }
/** A clip as the on-device model takes it best: starting just before the first word, and no longer than holds the phrase. */
const forLocal = (samples: Float32Array) => trimLeadingQuiet(samples, SAMPLE_RATE * 0.1).subarray(0, WAKE_WINDOW)
const askReady = () => Boolean(useStore.getState().ai?.configured)

export const useVoice = create<VoiceState>((set, get) => {
  const listening = () => get().phase === 'waiting' || get().phase === 'hearing'
  /** Speech is kept while a request is being worked on too: after the phrase and a pause, the request often starts before the phrase is confirmed. */
  const recording = () => listening() || get().phase === 'working'

  /** Whether the on-device model heard the wake phrase. What it heard is kept, which is how a missed or false wake is explained. */
  const wakes = (text: string) => {
    const woke = matchWake(text) !== null
    console.debug(`[voice] heard on this computer: ${JSON.stringify(text)}${woke ? ' (wake)' : ''}`)
    if (text.trim()) set({ lastLocal: text.trim() })
    return woke
  }

  const dropLive = () => {
    live?.stop()
    live = null
  }

  const showAsk = () => {
    const app = useStore.getState()
    openedAsk = !app.askOpen
    app.set({ askOpen: true })
  }

  const awaitRequest = (said: Float32Array | null = null) => {
    clearTimeout(followUp)
    set({ phase: 'hearing', heard: '' })
    followUp = setTimeout(() => { if (get().phase === 'hearing' && !live) set({ phase: 'waiting' }) }, FOLLOW_UP_MS)
    // The request may have been started, or even finished, while the phrase was being checked.
    if (stretch) goLive()
    else if (said) {
      phraseDue = false
      void finish(said).catch(fail)
    }
  }

  /** The wake phrase was heard: show Ask straight away and start writing down what is being said. */
  const goLive = () => {
    clearTimeout(followUp)
    phraseDue = get().phase !== 'hearing'
    if (phraseDue) showAsk()
    set({ phase: 'hearing', heard: '', error: '' })
    const afterPhrase = phraseDue
    const session = startLive((text) => {
      if (live !== session) return
      // Until the phrase itself has been written down in full, there is no request to show yet.
      set({ heard: afterPhrase ? matchWake(text)?.rest ?? '' : text })
    })
    live = session
    // What was said before the phrase was recognised goes first, so no words are lost.
    if (stretch?.length) session.push(joinSamples(stretch))
  }

  /** The person has stopped talking: get the final words and hand the request to Ask. */
  const finish = async (audio: Float32Array) => {
    clearTimeout(followUp)
    dropLive()
    set({ phase: 'working', error: '' })
    meanwhile = null
    confirming = true
    let text: string
    try {
      // The words shown so far were quick ones. The request is written down again from the whole recording, which is more accurate.
      text = (await api.transcribe(toBase64(encodeWav(audio, SAMPLE_RATE)))).text
    } finally {
      confirming = false
    }
    const said = meanwhile
    meanwhile = null
    if (get().phase !== 'working') return
    // The on-device model is easily fooled, so the accurate transcript has to start with the phrase too.
    if (phraseDue && !matchWake(text)) {
      console.debug(`[voice] not for Quarry after all: ${JSON.stringify(text)}`)
      if (openedAsk) useStore.getState().set({ askOpen: false })
      set({ phase: 'waiting', heard: '' })
      return
    }
    useStore.getState().set({ askOpen: true })
    const request = commandFrom(text)
    // The wake phrase and then nothing: keep the floor open for the request.
    if (!request) return awaitRequest(said)
    set({ lastRequest: request })
    const app = useStore.getState()
    const tab = app.tabs.find((t) => t.id === app.activeTabId)
    // "This query" means the one in front of the person, so it always goes along when there is one.
    const asking = app.ask(request, { sql: app.view === 'editor' && Boolean(tab?.sql.trim()), spoken: true })
    // The request is in the conversation now, so the words in progress give way to it.
    set({ heard: '' })
    await asking
    if (get().phase === 'working') set({ phase: 'waiting' })
  }

  const fail = (err: unknown) => {
    dropLive()
    set({ phase: get().phase === 'off' ? 'off' : 'waiting', heard: '', error: (err as Error).message })
  }

  const speechStart = () => {
    if (!recording()) return
    stretch = recent
    stretchLength = recentLength
    recent = []
    recentLength = 0
    stretchId++
    nextCheck = FIRST_CHECK
    // After the wake phrase on its own, whatever is said next is the request.
    if (get().phase === 'hearing' && !live) goLive()
  }

  const sound = (piece: Float32Array) => {
    if (!recording()) return
    if (!stretch) {
      recent.push(piece)
      recentLength += piece.length
      while (recent.length > 1 && recentLength - recent[0].length >= PRE_ROLL) recentLength -= recent.shift()!.length
      return
    }
    stretch.push(piece)
    stretchLength += piece.length
    if (live) return live.push(piece)
    if (get().phase !== 'waiting' || checking || stretchLength < nextCheck || nextCheck > WAKE_WINDOW) return
    // Far enough in to hold the phrase: look for it now, without waiting for the person to finish.
    checking = true
    nextCheck += CHECK_STEP
    const id = stretchId
    void hearLocally(forLocal(joinSamples([...stretch, new Float32Array(CUT_PADDING)])))
      .then((text) => { if (id === stretchId && stretch && !live && get().phase === 'waiting' && wakes(text)) goLive() })
      .catch(() => undefined)
      .finally(() => { checking = false })
  }

  const falseStart = () => {
    stretch = null
    stretchLength = 0
    stretchId++
    if (!live) return
    dropLive()
    if (phraseDue) set({ phase: 'waiting', heard: '' })
    else awaitRequest()
  }

  const speechEnd = async () => {
    const audio = stretch ? joinSamples(stretch) : null
    stretch = null
    stretchLength = 0
    stretchId++
    if (audio && confirming && get().phase === 'working') meanwhile = audio
    if (!audio || !listening()) return
    try {
      if (live) return await finish(audio)
      if (get().phase !== 'waiting') return
      // Short enough to have ended before the phrase was looked for.
      const heard = await hearLocally(forLocal(audio))
      const woke = wakes(heard)
      if (get().phase !== 'waiting') return
      phraseDue = true
      if (!woke) {
        // Not clearly the phrase, but close: the accurate service decides, and nothing shows unless it agrees.
        if (!mightBeWake(heard)) return
        openedAsk = false
        return await finish(audio)
      }
      showAsk()
      if (audio.length < PHRASE_ONLY) awaitRequest()
      else await finish(audio)
    } catch (err) {
      fail(err)
    }
  }

  const reset = () => {
    clearTimeout(followUp)
    dropLive()
    recent = []
    recentLength = 0
    stretch = null
    stretchLength = 0
    stretchId++
    meanwhile = null
  }

  return {
    phase: 'off',
    configured: null,
    heard: '',
    lastRequest: '',
    lastLocal: '',
    error: '',

    async init() {
      try {
        set({ configured: (await api.voiceStatus()).configured })
      } catch {
        set({ configured: false })
      }
    },

    resume() {
      if (get().phase === 'off' && remembered()) void get().start()
    },

    toggle() {
      if (get().phase === 'off') void get().start()
      else get().stop()
    },

    async start() {
      if (get().phase !== 'off') return
      // A request has nowhere to go without Ask, so there is nothing to listen for.
      if (!get().configured || !askReady()) {
        set({ error: 'Set up Ask first: what you say is sent there.' })
        return
      }
      set({ phase: 'starting', error: '' })
      remember(true)
      try {
        await loadLocalSpeech()
      } catch (err) {
        set({ phase: 'off', error: `Could not load the speech model: ${(err as Error).message}` })
        return
      }
      if (get().phase !== 'starting') return
      stopListening = listen({
        onSpeechStart: () => { if (!feeding) speechStart() },
        onSound: (piece) => { if (!feeding) sound(piece) },
        onSpeech: () => { if (!feeding) void speechEnd() },
        onFalseStart: () => { if (!feeding) falseStart() },
        onListening: (on) => {
          const { phase } = get()
          if (phase === 'off') return
          // Coming back to the app starts afresh: a half-finished request does not survive leaving it.
          if (!on) { reset(); set({ phase: 'away', heard: '' }) } else if (phase === 'starting' || phase === 'away') set({ phase: 'waiting' })
        },
        onError: (message) => { get().stop(); set({ error: message }) },
      })
      // The microphone opens only when Quarry is in front; until then this shows as away.
      if (get().phase === 'starting') set({ phase: 'away' })
    },

    stop(forget = true) {
      stopListening?.()
      stopListening = undefined
      reset()
      if (forget) remember(false)
      set({ phase: 'off', heard: '' })
    },

    async hear(samples) {
      if (feeding || !listening()) return
      feeding = true
      try {
        stretch = null
        speechStart()
        const began = performance.now()
        for (let at = 0; at < samples.length;) {
          const due = Math.min(samples.length, Math.floor(((performance.now() - began) / 1000) * SAMPLE_RATE) + PIECE)
          for (; at < due; at += PIECE) sound(samples.slice(at, at + PIECE))
          await new Promise((resolve) => setTimeout(resolve, 30))
        }
        await speechEnd()
      } finally {
        feeding = false
      }
    },
  }
})

// Lets recorded speech be fed through the same path as the microphone, for checking it end to end.
if (typeof window !== 'undefined') (window as unknown as { quarryVoice?: unknown }).quarryVoice = useVoice
