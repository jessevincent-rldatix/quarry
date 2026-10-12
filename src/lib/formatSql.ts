import { format } from 'sql-formatter'
import { scan, splitBatches, type Token } from '@shared/readonly'
import type { Dialect } from '@shared/types'

const FORMATTER: Record<Dialect, 'sqlite' | 'transactsql' | 'postgresql' | 'mysql' | 'snowflake' | 'spark'> = {
  sqlite: 'sqlite', mssql: 'transactsql', postgres: 'postgresql', mysql: 'mysql', snowflake: 'snowflake', databricks: 'spark',
}

const words = (list: string) => new Set(list.split(' '))

/*
 * The formatter upper-cases every word on its keyword list, including ones used as a name:
 * `SELECT 1 AS first` became `AS FIRST`, which changes the column header the database returns.
 * So its upper-casing is only kept where the word cannot be a name; everywhere else the word goes
 * back to exactly what was typed. When in doubt the typed case wins, since that is always safe.
 */

// Reserved by all four databases: never an unquoted column or alias.
const HARD = words('select from where group having order and or not in is null case when then else as distinct union into create table on all join using unique primary foreign references constraint check default collate')
// Keywords that at least one database also accepts as a plain name. Kept upper-case only where a name cannot stand.
const SOFT = words('by set values insert update delete drop alter desc asc end limit offset with like ilike between exists begin if over partition left right inner outer full cross natural top except intersect returning true false recursive declare exec execute print return while merge output fetch lateral apply truncate commit rollback explain use any some escape for window to add')
// Of the soft ones, those that can begin an expression or a list item.
const EXPR_START = words('exists top true false with values partition any some default')
// And those that can begin a statement, which is what follows THEN, ELSE or an opening bracket.
const STATEMENT = words('begin set insert update delete print return exec execute declare if while with merge truncate drop alter commit rollback use end fetch')
const STATEMENT_PREV = words('then else')
const STAR_PREV = words('select distinct all')
// After one of these comes a value or a name, never a clause keyword.
const OPERAND_PREV = words('select distinct all where and or on when then else having by case like ilike between set returning')
const OPERATORS = '=<>!+-/%|&^~*:'
// Words that are keywords only beside a particular neighbour (NULLS FIRST, PRIMARY KEY, CURRENT ROW).
const FRAME_NEXT = words('between unbounded current only fetch')
const PHRASE: Record<string, { prev?: Set<string>; next?: Set<string>; afterNumber?: boolean }> = {
  first: { prev: words('nulls fetch') }, last: { prev: words('nulls') }, nulls: { next: words('first last') },
  rows: { next: FRAME_NEXT }, range: { next: FRAME_NEXT }, groups: { next: FRAME_NEXT },
  unbounded: { next: words('preceding following') },
  preceding: { prev: words('unbounded'), afterNumber: true }, following: { prev: words('unbounded'), afterNumber: true },
  current: { next: words('row') }, row: { prev: words('current') },
  key: { prev: words('primary foreign') }, action: { prev: words('no') }, no: { next: words('action') },
  only: { prev: words('rows row') }, next: { prev: words('fetch') },
}
// Object kinds, keywords only straight after the verb (CREATE INDEX), since `index` and `view` are common column names.
const NOUN = words('index view column database schema procedure proc function trigger transaction tran temp temporary')
const NOUN_PREV = words('create drop alter add unique temp temporary replace rename begin commit rollback truncate materialized clustered nonclustered save')
// After AS comes an alias, unless it is one of these starting a query or a procedure body.
const AS = words('as')
const AS_FOLLOW = words('select with begin insert update delete values materialized not declare set if return exec execute merge while print')
const ALIAS_END = words('from into where group order having limit union except intersect on join inner left right full cross')
// A name followed by a bracket after one of these is a table, not a function call.
const TABLE_INTRO = words('into table update references exists view')

const isPunct = (t: Token | undefined, chars: string) => t?.kind === 'punct' && chars.includes(t.text)
const isWord = (t: Token | undefined, set: Set<string> | undefined) => t?.kind === 'word' && set !== undefined && set.has(t.text)

/** True when the formatter was right to upper-case the word at `i`: it is a keyword there, not a name. */
function isKeywordAt(tokens: Token[], i: number, afterNumber: boolean): boolean {
  const word = tokens[i].text
  const prev = tokens[i - 1]
  const next = tokens[i + 1]
  if (isPunct(prev, '.') || isPunct(next, '.')) return false
  if (isWord(prev, AS)) return AS_FOLLOW.has(word) && next !== undefined && !isPunct(next, ',);') && !isWord(next, ALIAS_END)
  // Function calls and keywords that take a bracket: IN (, VALUES (, OVER (, count(.
  if (isPunct(next, '(')) return !isWord(prev, TABLE_INTRO)
  const phrase = PHRASE[word]
  if (phrase) return isWord(prev, phrase.prev) || isWord(next, phrase.next) || (phrase.afterNumber === true && afterNumber)
  if (NOUN.has(word)) return isWord(prev, NOUN_PREV)
  if (HARD.has(word)) return true
  if (!SOFT.has(word)) return false
  if (afterNumber) return true
  if (isPunct(prev, '(') || isWord(prev, STATEMENT_PREV)) return STATEMENT.has(word) || EXPR_START.has(word)
  // `SELECT *` and `count(*)` are not a multiplication.
  const star = isPunct(prev, '*') && (i < 2 || isPunct(tokens[i - 2], '(,.') || isWord(tokens[i - 2], STAR_PREV))
  const wantsOperand = isWord(prev, OPERAND_PREV) || isPunct(prev, ',') || (isPunct(prev, OPERATORS) && !star)
  return !wantsOperand || EXPR_START.has(word)
}

/** Puts back the typed case of every word the formatter upper-cased that is, or may be, a name. */
function keepNames(original: string, formatted: string, dialect: Dialect): string | null {
  const before = scan(original, dialect, { variables: true })
  const after = scan(formatted, dialect, { variables: true })
  // The formatter only moves whitespace and changes case, so the two must line up token for token.
  if (before.unterminated || after.unterminated || before.tokens.length !== after.tokens.length) return null
  let out = ''
  let cursor = 0
  for (let i = 0; i < after.tokens.length; i++) {
    const was = before.tokens[i]
    const now = after.tokens[i]
    if (was.kind !== now.kind || was.text.length !== now.text.length) return null
    if (now.kind !== 'word') {
      if (was.text !== now.text) return null
      continue
    }
    if (was.text !== now.text) return null
    const typed = original.slice(was.start, was.start + was.text.length)
    if (typed === formatted.slice(now.start, now.start + now.text.length)) continue
    const previous = after.tokens[i - 1]
    const gap = formatted.slice(previous ? previous.start + previous.text.length : 0, now.start)
    // The scanner does not report numbers, so one is found by looking at what lies between two tokens.
    const afterNumber = /\d/.test(gap) && !/--|\/\*|#/.test(gap)
    if (isKeywordAt(after.tokens, i, afterNumber)) continue
    out += formatted.slice(cursor, now.start) + typed
    cursor = now.start + now.text.length
  }
  return out + formatted.slice(cursor)
}

function formatBatch(sql: string, dialect: Dialect): string {
  const options = {
    language: FORMATTER[dialect],
    // Keep {{variables}} intact instead of letting the formatter split the braces.
    paramTypes: { custom: [{ regex: String.raw`\{\{[^}]*\}\}` }] },
  }
  const upper = format(sql, { ...options, keywordCase: 'upper', functionCase: 'upper' })
  // If the text cannot be lined up with the original, leave every word as typed rather than guess.
  return keepNames(sql, upper, dialect) ?? format(sql, options)
}

/**
 * Lays the SQL out and upper-cases keywords and built-in function names. Names and aliases keep
 * the case they were typed in, so formatting never changes the column headers a query returns.
 * Throws when the formatter cannot parse the text.
 */
export function formatSql(sql: string, dialect: Dialect): string {
  if (dialect !== 'mssql') return formatBatch(sql, dialect)
  // GO only works on a line of its own, and the formatter would join it to the next statement.
  // So each batch is formatted separately and the GO lines go back between them as they were.
  const separators = (text: string) => text.split('\n').map((line) => line.trim()).filter(Boolean)
  const parts: string[] = []
  let cursor = 0
  for (const batch of splitBatches(sql)) {
    parts.push(...separators(sql.slice(cursor, batch.start)), formatBatch(batch.sql, dialect))
    cursor = batch.end
  }
  parts.push(...separators(sql.slice(cursor)))
  return parts.join('\n')
}
