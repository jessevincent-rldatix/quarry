import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { MicrophoneEvents } from '@/lib/voice/microphone'

const mocks = vi.hoisted(() => ({
  events: undefined as MicrophoneEvents | undefined,
  transcribe: vi.fn<(audio: string) => Promise<{ text: string }>>(),
  hearLocally: vi.fn<(samples: Float32Array) => Promise<string>>(),
  startLive: vi.fn(() => ({ push: vi.fn(), stop: vi.fn() })),
  ask: vi.fn(async () => undefined),
}))

vi.mock('@/lib/api', () => ({ api: { transcribe: mocks.transcribe } }))
vi.mock('@/lib/voice/liveTranscript', () => ({ startLive: mocks.startLive }))
vi.mock('@/lib/voice/localSpeech', () => ({ loadLocalSpeech: async () => undefined, hearLocally: mocks.hearLocally }))
vi.mock('@/lib/voice/microphone', () => ({
  SAMPLE_RATE: 16000,
  listen: (events: MicrophoneEvents) => {
    mocks.events = events
    events.onListening(true)
    return () => undefined
  },
}))
vi.mock('./index', () => {
  const state = { ai: { configured: true }, askOpen: false, tabs: [], activeTabId: '', view: 'editor', set: () => undefined, ask: mocks.ask }
  return { useStore: { getState: () => state } }
})

import { useVoice } from './voiceStore'

const settle = () => new Promise((resolve) => setTimeout(resolve, 0))

/** A stretch of speech this long, as the microphone reports it; `end` false leaves the person still talking. */
async function say(seconds: number, end = true) {
  const events = mocks.events!
  events.onSpeechStart()
  for (let at = 0; at < seconds * 16000; at += 512) events.onSound(new Float32Array(512).fill(0.1))
  await settle()
  if (end) events.onSpeech(new Float32Array(0))
  await settle()
}

/** A transcript that arrives only when the test says so, as Deepgram's does after a round trip. */
function slowTranscript() {
  let arrive!: (text: string) => void
  mocks.transcribe.mockReturnValueOnce(new Promise((resolve) => { arrive = (text) => resolve({ text }) }))
  return async (text: string) => { arrive(text); await settle() }
}

describe('a request said after the wake phrase and a pause', () => {
  beforeEach(async () => {
    vi.clearAllMocks()
    // Clearing keeps queued replies, and one left by a failed test would answer the next.
    mocks.transcribe.mockReset()
    mocks.hearLocally.mockReset()
    useVoice.setState({ configured: true })
    await useVoice.getState().start()
    expect(useVoice.getState().phase).toBe('waiting')
  })
  afterEach(() => useVoice.getState().stop())

  it('is heard when it starts while the phrase is still being confirmed', async () => {
    mocks.hearLocally.mockResolvedValue('Hey seven of nine')
    const confirm = slowTranscript()
    await say(1.4)
    expect(useVoice.getState().phase).toBe('working')

    // The person carries on before the accurate transcript of the phrase is back.
    await say(0.5, false)
    await confirm('Hey, 7 of 9.')
    expect(useVoice.getState().phase).toBe('hearing')
    expect(mocks.startLive).toHaveBeenCalledTimes(2)

    mocks.transcribe.mockResolvedValueOnce({ text: 'Show me the trucks.' })
    mocks.events!.onSpeech(new Float32Array(0))
    await settle()
    expect(mocks.ask).toHaveBeenCalledWith('Show me the trucks.', expect.objectContaining({ spoken: true }))
  })

  it('is heard when it is over before the phrase is confirmed', async () => {
    mocks.hearLocally.mockResolvedValue('Hey seven of nine')
    const confirm = slowTranscript()
    await say(1.4)
    await say(0.6)
    mocks.transcribe.mockResolvedValueOnce({ text: 'Open the map.' })
    await confirm('Hey, 7 of 9.')
    expect(mocks.ask).toHaveBeenCalledWith('Open the map.', expect.objectContaining({ spoken: true }))
  })

  it('is heard when the phrase was too short to be checked while it was said', async () => {
    let heard!: (text: string) => void
    mocks.hearLocally.mockReturnValueOnce(new Promise((resolve) => { heard = resolve }))
    await say(0.8)
    await say(0.5, false)
    heard('Hey seven of nine')
    await settle()
    expect(useVoice.getState().phase).toBe('hearing')
    expect(mocks.startLive).toHaveBeenCalledTimes(1)

    mocks.transcribe.mockResolvedValueOnce({ text: 'Run this query.' })
    mocks.events!.onSpeech(new Float32Array(0))
    await settle()
    expect(mocks.ask).toHaveBeenCalledWith('Run this query.', expect.objectContaining({ spoken: true }))
  })

  it('is not taken from speech that followed something that was not the phrase', async () => {
    mocks.hearLocally.mockResolvedValue('Hey seven of nine')
    const confirm = slowTranscript()
    await say(1.4)
    await say(0.6)
    await confirm('Have seven or nine of them.')
    expect(useVoice.getState().phase).toBe('waiting')
    expect(mocks.ask).not.toHaveBeenCalled()
  })
})
