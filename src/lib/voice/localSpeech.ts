import type { LocalSpeechReply, LocalSpeechRequest } from './localSpeech.worker'

/** The on-device speech model, behind a promise. One worker is shared and started on first use. */
let worker: Worker | undefined
let nextId = 1
const waiting = new Map<number, { resolve: (text: string) => void; reject: (err: Error) => void }>()

function send(samples?: Float32Array): Promise<string> {
  if (!worker) {
    worker = new Worker(new URL('./localSpeech.worker.ts', import.meta.url), { type: 'module' })
    worker.onmessage = (event: MessageEvent<LocalSpeechReply>) => {
      const { id, text, error } = event.data
      const pending = waiting.get(id)
      waiting.delete(id)
      if (error) pending?.reject(new Error(error))
      else pending?.resolve(text ?? '')
    }
    worker.onerror = (event) => {
      for (const pending of waiting.values()) pending.reject(new Error(event.message || 'The speech model stopped.'))
      waiting.clear()
      worker = undefined
    }
  }
  const id = nextId++
  const request: LocalSpeechRequest = { id, samples }
  return new Promise((resolve, reject) => {
    waiting.set(id, { resolve, reject })
    worker!.postMessage(request)
  })
}

/** Downloads and loads the model, so the first thing said is not lost to a long wait. */
export const loadLocalSpeech = () => send().then(() => undefined)

/** What was said in these samples (16 kHz mono), as the small on-device model hears it. */
export const hearLocally = (samples: Float32Array) => send(samples)
