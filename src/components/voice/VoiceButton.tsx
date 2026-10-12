import { useEffect } from 'react'
import { Loader2, Mic, MicOff, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { WAKE_PHRASE } from '@/lib/wake'
import { useVoice, type VoicePhase } from '@/store/voiceStore'

const LABEL: Record<VoicePhase, string> = {
  off: WAKE_PHRASE,
  starting: 'Starting…',
  waiting: `Say "${WAKE_PHRASE}"`,
  away: 'Paused',
  hearing: 'Listening…',
  working: 'Working…',
}

const HELP: Record<VoicePhase, string> = {
  off: `Switch on to talk to Quarry. Say "${WAKE_PHRASE}" and then what you want, such as "add a limit of ten rows to this query" or "open the refund audit". It listens only while Quarry is the window in front.`,
  starting: 'Loading the speech model and opening the microphone. The first time, the model is downloaded (about 30 MB).',
  waiting: `Listening for "${WAKE_PHRASE}". Until you say it, nothing you say leaves this computer. Click to switch off.`,
  away: 'Quarry is not the window in front, so the microphone is closed. Click to switch off.',
  hearing: 'Go ahead: say what you want. This is sent to Deepgram to be written down, and the words appear in Ask as you speak. Click to switch off.',
  working: 'Your request has gone to Ask. Click to switch off.',
}

/** The microphone in the header: switches listening for the wake phrase on and off, and shows what it is doing. */
export function VoiceButton() {
  const phase = useVoice((s) => s.phase)
  const configured = useVoice((s) => s.configured)
  const error = useVoice((s) => s.error)
  const lastLocal = useVoice((s) => s.lastLocal)
  // Null until the server has said whether Ask is set up.
  const askReady = useStore((s) => (s.ai ? s.ai.configured : null))
  const { init, toggle, resume, stop } = useVoice.getState()

  useEffect(() => { void init() }, [init])
  // Spoken requests go to Ask, so listening follows it: on again once Ask is ready, off if it stops being.
  useEffect(() => {
    if (!configured || askReady === null) return
    if (askReady) resume()
    else stop(false)
  }, [configured, askReady, resume, stop])

  // Without a key there is nothing to switch on, and no reason to show a dead button.
  if (!configured || askReady === null) return null
  if (!askReady) {
    return (
      <button onClick={() => { useStore.getState().set({ askOpen: true }); useStore.getState().setDialog({ kind: 'ai-settings' }) }}
              title="Voice sends what you say to Ask, so Ask has to be set up before it can listen. Click to set it up."
              className="flex h-6 items-center gap-1.5 rounded-md bg-chrome-deep px-2 text-[12px] text-chrome-text hover:text-white">
        <MicOff className="size-3.5" />Set up Ask to use voice
      </button>
    )
  }
  const on = phase !== 'off'
  const Icon = phase === 'starting' || phase === 'working' ? Loader2 : on && phase !== 'away' ? Mic : MicOff
  return (
    <>
      {error && (
        <span role="alert" className="flex max-w-[380px] items-center gap-1 rounded-md bg-red-100 py-0.5 pl-2 pr-1 text-[12px] text-red-900">
          <span className="truncate" title={error}>{error}</span>
          <button aria-label="Dismiss" onClick={() => useVoice.setState({ error: '' })} className="rounded p-0.5 hover:bg-red-200"><X className="size-3" /></button>
        </span>
      )}
      <button onClick={toggle} aria-pressed={on} title={phase === 'waiting' && lastLocal ? `${HELP[phase]} The last thing heard on this computer: “${lastLocal}”.` : HELP[phase]}
              className={cn(
                'flex h-6 items-center gap-1.5 rounded-md px-2 text-[12px]',
                phase === 'hearing' ? 'bg-accent font-medium text-chrome' : on ? 'bg-chrome-deep text-white' : 'bg-chrome-deep text-chrome-text hover:text-white',
              )}>
        <Icon className={cn('size-3.5', (phase === 'starting' || phase === 'working') && 'animate-spin', phase === 'hearing' && 'animate-pulse')} />
        <span aria-live="polite">{LABEL[phase]}</span>
      </button>
    </>
  )
}
