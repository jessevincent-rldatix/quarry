import { randomUUID } from 'node:crypto'
import { WebSocket } from 'ws'

/**
 * Speech to text for voice requests ("Hey Seven of Nine"). The page decides locally whether the wake phrase was said;
 * only speech that starts with it is sent here, and from here to Deepgram. The key never leaves
 * the server, which is why the live stream passes through here and not straight from the page.
 */

/** About a minute of 16 kHz mono speech. Nothing spoken to Quarry should be longer. */
export const MAX_AUDIO_BYTES = 2_000_000

/** A live session ends by itself after this long. */
const LIVE_MAX_MS = 90_000

interface DeepgramLive {
  type?: string
  is_final?: boolean
  channel?: { alternatives?: { transcript?: string }[] }
}

export interface LiveSession {
  /** Sends sound (16 kHz, 16-bit, mono, no header) and returns the words heard so far. */
  send: (pcm: Buffer) => string
  close: () => void
}

interface DeepgramResponse {
  results?: { channels?: { alternatives?: { transcript?: string }[] }[] }
  err_msg?: string
}

export function createVoice(env: Record<string, string | undefined> = process.env) {
  const key = (env.DEEPGRAM_API_KEY ?? '').trim()
  const model = env.DEEPGRAM_MODEL?.trim() || 'nova-3'

  /** Sends one utterance (a WAV file) and returns what was said. */
  async function transcribe(wav: Buffer): Promise<string> {
    if (!key) throw new Error('Set DEEPGRAM_API_KEY in the .env file beside package.json, then restart Quarry.')
    if (wav.length > MAX_AUDIO_BYTES) throw new Error('That was too long to transcribe. Say it in under a minute.')
    // The name is hinted so it is not heard as "query" or "Corey".
    const url = `https://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&smart_format=true&language=en&keyterm=Quarry`
    let response: Response
    try {
      response = await fetch(url, { method: 'POST', headers: { authorization: `Token ${key}`, 'content-type': 'audio/wav' }, body: new Blob([new Uint8Array(wav)]), signal: AbortSignal.timeout(20_000) })
    } catch {
      throw new Error('Could not reach Deepgram. Check the network and try again.')
    }
    const body = await response.json().catch(() => null) as DeepgramResponse | null
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new Error('Deepgram refused the key in DEEPGRAM_API_KEY.')
      throw new Error(`Deepgram could not transcribe that (${response.status}${body?.err_msg ? `: ${body.err_msg}` : ''}).`)
    }
    return body?.results?.channels?.[0]?.alternatives?.[0]?.transcript?.trim() ?? ''
  }

  // ── Live: words as they are spoken ─────────────────────────────────────────
  const sessions = new Map<string, LiveSession>()

  /**
   * Opens a stream to Deepgram that returns words while the person is still talking. The page
   * sends sound in small pieces and gets back the text so far with each one. One at a time:
   * a new session ends any older one. These words are for showing; the request itself is
   * written down from the whole recording by `transcribe`, which is the more accurate of the two.
   */
  function openLive(): string {
    if (!key) throw new Error('Set DEEPGRAM_API_KEY in the .env file beside package.json, then restart Quarry.')
    for (const old of sessions.values()) old.close()
    const id = randomUUID()
    const url = `wss://api.deepgram.com/v1/listen?model=${encodeURIComponent(model)}&encoding=linear16&sample_rate=16000&channels=1&interim_results=true&smart_format=true&language=en&keyterm=Quarry`
    const socket = new WebSocket(url, { headers: { authorization: `Token ${key}` }, handshakeTimeout: 8000 })
    const settled: string[] = []
    let unsettled = ''
    let error = ''
    let closed = false
    const queued: Buffer[] = []

    const close = () => {
      if (closed) return
      closed = true
      clearTimeout(expiry)
      sessions.delete(id)
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'CloseStream' }))
      // Leaves Deepgram a moment to take the message above; terminate() is safe in any state.
      setTimeout(() => socket.terminate(), 500)
    }
    // Nothing spoken to Quarry lasts this long; a session left open is a page that went away.
    const expiry = setTimeout(close, LIVE_MAX_MS)

    socket.on('open', () => { for (const piece of queued.splice(0)) socket.send(piece) })
    socket.on('message', (data) => {
      let message: DeepgramLive
      try { message = JSON.parse(String(data)) as DeepgramLive } catch { return }
      if (message.type !== 'Results') return
      const words = message.channel?.alternatives?.[0]?.transcript?.trim() ?? ''
      if (message.is_final) {
        if (words) settled.push(words)
        unsettled = ''
      } else {
        unsettled = words
      }
    })
    socket.on('unexpected-response', (_request, response) => {
      error = response.statusCode === 401 || response.statusCode === 403 ? 'Deepgram refused the key in DEEPGRAM_API_KEY.' : `Deepgram would not start listening (${response.statusCode}).`
      close()
    })
    socket.on('error', () => { error ||= 'Could not reach Deepgram. Check the network and try again.'; close() })
    socket.on('close', () => { if (!closed) { error ||= 'Deepgram stopped listening.'; close() } })

    const text = () => [...settled, unsettled].filter(Boolean).join(' ')
    sessions.set(id, {
      close,
      send(pcm) {
        if (error) throw new Error(error)
        if (closed) throw new Error('That stretch of listening has ended.')
        if (socket.readyState === WebSocket.OPEN) socket.send(pcm)
        else queued.push(pcm)
        return text()
      },
    })
    return id
  }

  const live = (id: string): LiveSession => {
    const session = sessions.get(id)
    if (!session) throw new Error('That stretch of listening has ended.')
    return session
  }

  return { configured: key !== '', transcribe, openLive, live }
}
