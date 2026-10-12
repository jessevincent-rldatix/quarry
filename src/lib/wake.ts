/**
 * Decides whether something that was said starts with the wake phrase.
 *
 * The phrase is "Hey Seven of Nine": three everyday words that every speech model writes
 * correctly, which matters because the check runs on what a small on-device model heard.
 * "Hey Quarry" is still answered, but that model has never met the name and writes "Quarty",
 * "query", "Corey" and more, so it is matched loosely and misses more often.
 *
 * Either name counts only straight after a greeting at the very start, which is what keeps
 * "seven of nine rows are null" and "hey, the query on line 12 looks wrong" from waking it. A
 * wake is also checked a second time: the accurate transcript of the request must start with
 * the phrase as well.
 */

/** The phrase as the app shows it. */
export const WAKE_PHRASE = 'Hey 7 of 9'

// "Seven of nine" as models write it: in words or digits ("7 of 9", "7of9"), the small word sometimes swapped.
const SEVEN_OF_NINE = "(?:seven|7)(?:[\\s,-]+(?:(?:of|or|a|on|o|uh)[\\s,-]+)?|of|or)(?:nine|9|nein)(?![A-Za-z0-9'])"
// The on-device model often writes this "hey" as "A" ("A seven of nine", "A7 of 9"). Nobody says that by accident.
const HEY_SEVEN_OF_NINE = new RegExp(`^[\\s"'(\\[]*(?:hello|heya|hey|hay|hi|he|eh|ay|a)[\\s,.!?;:-]*${SEVEN_OF_NINE}[\\s,.!?;:"')\\]-]*`, 'i')
// The name with no greeting heard, or another word in front of it.
const NEAR_SEVEN_OF_NINE = new RegExp(`^\\W*(?:[A-Za-z]+\\W+){0,2}${SEVEN_OF_NINE}`, 'i')

// Not "a" or "ok": "a query that counts rows" is ordinary talk in a SQL tool.
const GREETINGS = new Set(['hey', 'hay', 'hi', 'heya', 'hello'])
// Spellings of the name that are further from "quarry" than the distance below allows.
const SOUNDALIKES = new Set(['corey', 'cory', 'kori', 'korey', 'kory', 'queries', 'quarries'])

/** How many single-letter edits turn one word into the other. */
function distance(a: string, b: string): number {
  let row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    const next = [i]
    for (let j = 1; j <= b.length; j++) next[j] = Math.min(row[j] + 1, next[j - 1] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    row = next
  }
  return row[b.length]
}

// Words with the same shape as the name's misspellings that are ordinary things to say after "hey".
const NOT_THE_NAME = new Set(['copy', 'country', 'county', 'company', 'cookie', 'coffee', 'comfy', 'comedy', 'quickly', 'quietly', 'quality', 'quantity'])
// The name said quickly comes out as "quirti", "quody", "quorgie", "courtie": a "kw" or "ko" sound, a syllable, an "ee" sound.
const SHAPE = /^(qu|kw|co|ko)[a-z]{1,5}(y|i|ie|ey|ee)$/

/** Whether a word could be the name as a speech model might spell it. The first letter must fit, so "Harry" and "worry" do not. */
const soundsLikeQuarry = (word: string) =>
  /^[qkc]/.test(word) && !NOT_THE_NAME.has(word) && (SOUNDALIKES.has(word) || distance(word, 'quarry') <= 2 || SHAPE.test(word))

export interface WakeMatch {
  /** What was said after the wake phrase, as heard. Empty when only the phrase was said. */
  rest: string
}

/** The words after the wake phrase, or null when the speech did not start with it. */
export function matchWake(heard: string): WakeMatch | null {
  const sevenOfNine = HEY_SEVEN_OF_NINE.exec(heard)
  if (sevenOfNine) return { rest: heard.slice(sevenOfNine[0].length).trim() }
  // Models punctuate freely ("Hey, Quarry."), so punctuation around the two words is ignored.
  const match = /^[\s"'([]*([A-Za-z]+)[\s,.!?;:-]+([A-Za-z]+)(?![A-Za-z'])[\s,.!?;:"')\]-]*/.exec(heard)
  if (!match || !GREETINGS.has(match[1].toLowerCase()) || !soundsLikeQuarry(match[2].toLowerCase())) return null
  return { rest: heard.slice(match[0].length).trim() }
}

/**
 * Whether the speech might have started with the wake phrase although it was not heard clearly:
 * the name is among the first words without a greeting ("Seven of nine, open the map"), or
 * something like the old name is ("A quarty", "Equari, open", "Hay, Cori").
 * This is not enough to act on. It is enough to have the accurate service listen to that one
 * stretch of speech and decide.
 */
export function mightBeWake(heard: string): boolean {
  if (NEAR_SEVEN_OF_NINE.test(heard)) return true
  const first = heard.toLowerCase().match(/[a-z]+/g)?.slice(0, 3) ?? []
  return first.some((word) => soundsLikeQuarry(word) || soundsLikeQuarry(word.replace(/^[aeh]+(?=[qkc])/, '')))
}

/**
 * The command inside a full transcript: the words after the wake phrase when the transcript
 * starts with it, otherwise the whole thing. Used on the accurate transcript, where the phrase
 * may be spelled differently from how the on-device model heard it.
 */
export const commandFrom = (transcript: string) => (matchWake(transcript)?.rest ?? transcript).trim()
