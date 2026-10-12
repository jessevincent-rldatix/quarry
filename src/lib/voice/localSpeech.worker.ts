/// <reference lib="webworker" />
import { pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers'

/**
 * Speech to text that never leaves this machine, used only to hear the wake phrase. It runs in a
 * worker so that listening does not make typing stutter. The model (about 30 MB) is downloaded
 * from Hugging Face the first time and kept by the browser after that.
 */
const MODEL = 'onnx-community/moonshine-tiny-ONNX'

let loading: Promise<AutomaticSpeechRecognitionPipeline> | undefined
const model = () => (loading ??= pipeline('automatic-speech-recognition', MODEL, { dtype: 'q8' }) as Promise<AutomaticSpeechRecognitionPipeline>)

export type LocalSpeechRequest = { id: number; samples?: Float32Array }
export type LocalSpeechReply = { id: number; text?: string; error?: string }

// One at a time: the model gives nonsense when two clips are run through it at once.
let last: Promise<void> = Promise.resolve()
self.onmessage = (event: MessageEvent<LocalSpeechRequest>) => { last = last.then(() => hear(event.data)) }

async function hear({ id, samples }: LocalSpeechRequest): Promise<void> {
  const reply = (message: LocalSpeechReply) => self.postMessage(message)
  try {
    const transcribe = await model()
    // A request with no audio only asks for the model to be loaded.
    if (!samples) return reply({ id, text: '' })
    const out = await transcribe(samples)
    reply({ id, text: (Array.isArray(out) ? out[0] : out).text ?? '' })
  } catch (err) {
    loading = undefined
    reply({ id, error: err instanceof Error ? err.message : String(err) })
  }
}
