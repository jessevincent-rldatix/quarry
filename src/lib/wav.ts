/** Mono samples (each between -1 and 1) as 16-bit little-endian sound with no header, which is what a live stream takes. */
export function toPcm16(samples: Float32Array): Uint8Array {
  const bytes = new Uint8Array(samples.length * 2)
  const view = new DataView(bytes.buffer)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** Joins pieces of sound into one. */
export function joinSamples(pieces: Float32Array[]): Float32Array {
  const joined = new Float32Array(pieces.reduce((sum, p) => sum + p.length, 0))
  let at = 0
  for (const piece of pieces) { joined.set(piece, at); at += piece.length }
  return joined
}

/**
 * The samples without the quiet before the first sound, bar a short lead-in (`keep` samples).
 * "Quiet" is relative to the loudest moment, so it works for a soft voice and a noisy room alike.
 */
export function trimLeadingQuiet(samples: Float32Array, keep: number): Float32Array {
  let peak = 0
  for (let i = 0; i < samples.length; i++) peak = Math.max(peak, Math.abs(samples[i]))
  const floor = Math.max(0.004, peak * 0.06)
  let first = 0
  while (first < samples.length && Math.abs(samples[first]) < floor) first++
  return first === samples.length ? samples : samples.subarray(Math.max(0, first - keep))
}

/** Wraps mono samples (each between -1 and 1) in a 16-bit WAV file. */
export function encodeWav(samples: Float32Array, sampleRate: number): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2)
  const view = new DataView(bytes.buffer)
  const text = (at: number, value: string) => { for (let i = 0; i < value.length; i++) view.setUint8(at + i, value.charCodeAt(i)) }
  text(0, 'RIFF')
  view.setUint32(4, 36 + samples.length * 2, true)
  text(8, 'WAVE')
  text(12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true) // PCM
  view.setUint16(22, 1, true) // one channel
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, samples.length * 2, true)
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]))
    view.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true)
  }
  return bytes
}

/** Reads a 16-bit mono WAV file back into samples. For tests and for feeding recorded speech through the listener. */
export function decodeWav(bytes: Uint8Array): { samples: Float32Array; sampleRate: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  // Chunks may come in any order and writers add their own, so walk them to find the format and the data.
  let at = 12
  let sampleRate = 16000
  while (at + 8 <= bytes.length) {
    const id = String.fromCharCode(bytes[at], bytes[at + 1], bytes[at + 2], bytes[at + 3])
    const size = view.getUint32(at + 4, true)
    if (id === 'fmt ') sampleRate = view.getUint32(at + 12, true)
    if (id === 'data') {
      const count = Math.floor(Math.min(size, bytes.length - at - 8) / 2)
      const samples = new Float32Array(count)
      for (let i = 0; i < count; i++) samples[i] = view.getInt16(at + 8 + i * 2, true) / 0x8000
      return { samples, sampleRate }
    }
    at += 8 + size + (size % 2)
  }
  throw new Error('Not a WAV file')
}

/** Base64 of bytes, in pieces so a long recording does not overflow the argument limit. */
export function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(binary)
}
