import { api } from '@/lib/api'
import { joinSamples, toBase64, toPcm16 } from '@/lib/wav'

/** How often sound is sent on. Short enough that the words on screen keep up with the voice. */
const SEND_EVERY_MS = 150

export interface LiveTranscript {
  /** The next piece of sound from the microphone. */
  push: (samples: Float32Array) => void
  /** Ends the session. Nothing more is reported after this. */
  stop: () => void
}

/**
 * Sends speech to be written down while it is still being said, and reports the words so far,
 * so the person can see they are being heard. Sound is sent in order, one piece at a time, so a
 * slow reply delays the words but never scrambles them.
 *
 * This is for showing only. If it fails, the words simply stop appearing: the request itself is
 * written down afterwards from the whole recording.
 */
export function startLive(onText: (text: string) => void): LiveTranscript {
  let pending: Float32Array[] = []
  let failed = false
  let stopped = false
  const session = api.liveStart().then((r) => r.id)
  // Each send waits for the one before it.
  let sending: Promise<unknown> = session.catch(() => { failed = true })

  const timer = setInterval(() => {
    if (!pending.length || failed) return
    const samples = joinSamples(pending)
    pending = []
    sending = sending
      .then(async () => {
        if (failed || stopped) return
        const { text } = await api.liveSend(await session, toBase64(toPcm16(samples)))
        if (!stopped) onText(text)
      })
      .catch(() => { failed = true })
  }, SEND_EVERY_MS)

  return {
    push(samples) { if (!stopped) pending.push(samples) },
    stop() {
      if (stopped) return
      stopped = true
      clearInterval(timer)
      pending = []
      // Ends the session on the server too, so Deepgram is not left listening to nothing.
      void session.then((id) => api.liveSend(id, '', true)).catch(() => undefined)
    },
  }
}
