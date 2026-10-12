import type { MicVAD } from '@ricky0123/vad-web'

export const SAMPLE_RATE = 16000

export interface MicrophoneEvents {
  /** Someone started speaking. */
  onSpeechStart: () => void
  /** One stretch of speech, start to pause, as 16 kHz mono samples. */
  onSpeech: (samples: Float32Array) => void
  /** What started as speech was too short to be any: a cough, a click. */
  onFalseStart: () => void
  /** Every small piece of sound from the microphone (about 30 ms), speech or not. */
  onSound: (samples: Float32Array) => void
  /** Listening started, or stopped because the app is no longer in front. */
  onListening: (listening: boolean) => void
  onError: (message: string) => void
}

const inFront = () => document.visibilityState === 'visible' && document.hasFocus()

/**
 * Opens the microphone and cuts what it hears into stretches of speech, on this machine.
 *
 * It listens only while Quarry is the window in front. When the tab is hidden, the window is
 * minimised or another window takes focus, the microphone is released altogether, so the
 * browser's recording indicator goes off; it is opened again when Quarry comes back.
 *
 * Returns a function that stops listening for good.
 */
export function listen(events: MicrophoneEvents): () => void {
  let vad: MicVAD | undefined
  let opening = false
  let stopped = false

  const close = () => {
    const current = vad
    vad = undefined
    if (current) {
      // destroy() stops the tracks, which is what releases the microphone.
      void current.destroy().catch(() => undefined)
      events.onListening(false)
    }
  }

  const open = async () => {
    if (vad || opening || stopped || !inFront()) return
    opening = true
    try {
      const { MicVAD } = await import('@ricky0123/vad-web')
      const created = await MicVAD.new({
        model: 'v5',
        baseAssetPath: '/voice/',
        onnxWASMBasePath: '/voice/',
        // Less eager than the defaults, so a keyboard or a fan is not taken for speech.
        positiveSpeechThreshold: 0.5,
        negativeSpeechThreshold: 0.35,
        // A pause this long ends the stretch. Long enough for the breath after the wake phrase.
        redemptionMs: 900,
        onSpeechStart: events.onSpeechStart,
        onSpeechEnd: events.onSpeech,
        onVADMisfire: events.onFalseStart,
        // The detector reuses its buffer, so each piece is copied before it is kept.
        onFrameProcessed: (_probabilities, frame) => events.onSound(frame.slice()),
      })
      // Focus may have moved on while the microphone prompt was up.
      if (stopped || !inFront()) {
        void created.destroy().catch(() => undefined)
        return
      }
      vad = created
      events.onListening(true)
    } catch (err) {
      const name = (err as Error).name
      events.onError(
        name === 'NotAllowedError' ? 'The browser was not allowed to use the microphone. Allow it for this page, then switch listening on again.'
          : name === 'NotFoundError' ? 'No microphone was found.'
          : `Could not start listening: ${(err as Error).message}`,
      )
    } finally {
      opening = false
    }
  }

  const sync = () => { if (inFront()) void open(); else close() }
  document.addEventListener('visibilitychange', sync)
  window.addEventListener('focus', sync)
  window.addEventListener('blur', sync)
  sync()

  return () => {
    stopped = true
    document.removeEventListener('visibilitychange', sync)
    window.removeEventListener('focus', sync)
    window.removeEventListener('blur', sync)
    close()
  }
}
