import { describe, expect, it } from 'vitest'
import { commandFrom, matchWake, mightBeWake } from './wake'
import { decodeWav, encodeWav, toBase64, trimLeadingQuiet } from './wav'

describe('wake phrase', () => {
  // The first four are what the on-device model wrote for recordings of "Hey Quarry ...".
  const wakes: [string, string][] = [
    ['Hey Quarty, can you change this query to add a little', 'can you change this query to add a little'],
    ['Hey quarry can you change this query', 'can you change this query'],
    ['Hey, Quarry.', ''],
    ['Hey, quarry.', ''],
    ['hey query add a limit of ten', 'add a limit of ten'],
    ['Hey Corey, run it', 'run it'],
    ['  "Hi Quarrie!" explain this', 'explain this'],
    ['Hey Quary — sort by price', '— sort by price'],
    // What the on-device model and Deepgram wrote for recordings of "Hey Seven of Nine ...".
    ['Hey, 7 of 9, show me the map.', 'show me the map.'],
    ['Hey 7 of 9. Can you open up the refund', 'Can you open up the refund'],
    ['Hey, Seven of nine.', ''],
    ['A seven of nine.', ''],
    ['A7 of 9.', ''],
    ['hey seven of nine open the refund audit', 'open the refund audit'],
    ['Hey 7of9, run it', 'run it'],
    ['Hello, seven or nine. New tab', 'New tab'],
    ['HEY QUARRY', ''],
    // What the model wrote for recordings cut off while the speaker was still going.
    ['Hey quirti.', ''],
    ['Hey, quody.', ''],
    ['Hey, quorgie.', ''],
    ['Hey, Courtie, can you open?', 'can you open?'],
    ['Hey Quarity, open the refund audit and', 'open the refund audit and'],
  ]
  it.each(wakes)('wakes on %s', (heard, rest) => expect(matchWake(heard)).toEqual({ rest }))

  const ignored = [
    'Hey, the query online 12 looks wrong to me.',
    'I think we should rewrite this query before the meeting',
    'Show me the five most expensive products.',
    'A query that counts rows per month',
    'Okay query the orders table',
    'Hey Harry, are you free at three?',
    'Hey, worry about that later',
    'Hey Mary',
    'Hey',
    'Quarry, add a limit',
    'So hey Quarry is the name of the tool',
    "Hey query's wrong",
    'Seven of nine rows in that table are null.',
    'Hey, seven of the nine tests are failing.',
    'Hey, seven of it.',
    'Hey, 7 of 90 rows',
    'Hey 79 rows came back',
    'So hey seven of nine is the wake phrase',
    'Hey, can you open that?',
    'Hey, could you send me the file',
    'Hey, copy that query for me',
    'Hey, quickly check the totals',
    'Hey, come here',
    '',
  ]
  it.each(ignored)('ignores %s', (heard) => expect(matchWake(heard)).toBeNull())

  it.each(['A quarty, open the map', 'Equari, open the map', 'Hay, Cori.', 'Quarry, add a limit', 'So hey Quarry is the name', 'Hey, the quarry', 'Seven of nine, open the map', 'Okay 7 of 9 run it'])(
    'has the accurate service check %s', (heard) => expect(mightBeWake(heard)).toBe(true))
  it.each(['I think we should rewrite this', 'Show me the five most expensive products.', 'Hey, can you open that?', 'Quick question about the totals', ''])(
    'does not send %s anywhere', (heard) => expect(mightBeWake(heard)).toBe(false))

  it('takes the command out of the accurate transcript, however the name was spelled', () => {
    expect(commandFrom('Hey Quarry, can you change this query to add a limit of 10 rows?')).toBe('can you change this query to add a limit of 10 rows?')
    expect(commandFrom('Show me the five most expensive products.')).toBe('Show me the five most expensive products.')
  })
})

describe('wav', () => {
  it('round-trips samples and writes a valid header', () => {
    const samples = new Float32Array([0, 0.5, -0.5, 1, -1, 0.25])
    const bytes = encodeWav(samples, 16000)
    expect(bytes.length).toBe(44 + samples.length * 2)
    expect(String.fromCharCode(...bytes.subarray(0, 4))).toBe('RIFF')
    const back = decodeWav(bytes)
    expect(back.sampleRate).toBe(16000)
    back.samples.forEach((s, i) => expect(s).toBeCloseTo(samples[i], 3))
  })

  it('trims the quiet before the first sound, keeping a short lead-in', () => {
    const samples = new Float32Array(1000)
    samples.fill(0.5, 600)
    expect(trimLeadingQuiet(samples, 100).length).toBe(500)
    expect(trimLeadingQuiet(samples, 5000).length).toBe(1000)
    expect(trimLeadingQuiet(new Float32Array(50), 10).length).toBe(50)
  })

  it('clips samples outside the range instead of wrapping them', () => {
    const { samples } = decodeWav(encodeWav(new Float32Array([2, -2]), 16000))
    expect(samples[0]).toBeGreaterThan(0.99)
    expect(samples[1]).toBeLessThan(-0.99)
  })

  it('encodes long audio to base64 without overflowing', () => {
    const bytes = new Uint8Array(200_000).fill(65)
    expect(atob(toBase64(bytes)).length).toBe(200_000)
  })
})
