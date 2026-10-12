const words = (text: string) => text.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)
const stem = (word: string) => (word.length > 3 ? word.replace(/(es|s)$/, '') : word)

/**
 * The item whose name best fits what was asked for, or undefined when none is close.
 *
 * The wanted name comes from a model, or from speech, so it may differ in case, punctuation,
 * plurals or by a word ("the refund audit report" for "Refund audit"). An exact name always
 * wins; after that, the name sharing the most words, as long as it shares at least half of the
 * shorter of the two.
 */
export function closest<T>(wanted: string, items: T[], name: (item: T) => string): T | undefined {
  const want = words(wanted)
  if (!want.length) return undefined
  const flat = want.join(' ')
  const exact = items.find((item) => words(name(item)).join(' ') === flat)
  if (exact) return exact

  const wantStems = new Set(want.map(stem))
  let best: { item: T; score: number } | undefined
  for (const item of items) {
    const have = new Set(words(name(item)).map(stem))
    if (!have.size) continue
    let shared = 0
    for (const word of have) if (wantStems.has(word)) shared++
    if (shared / Math.min(have.size, wantStems.size) < 0.5) continue
    // Among names sharing as many words, the one with fewer other words is the closer.
    const score = shared - (have.size + wantStems.size - 2 * shared) * 0.01
    if (!best || score > best.score) best = { item, score }
  }
  return best?.item
}
