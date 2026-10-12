import { backslashEscapes, dateLiteral, escapeText, quoteName, quoteText } from '@shared/dialect'
import { scan, type Token } from '@shared/sqlScan'
import type { Dialect } from '@shared/types'

export { quoteText } from '@shared/dialect'

export const VAR_TYPES = ['text', 'number', 'date', 'ident', 'list', 'raw'] as const
export type VarType = (typeof VAR_TYPES)[number]

export interface TemplateVar {
  name: string
  type: VarType
  default?: string
}

/** Highlights anything written as {{...}} in the editor, valid or not. */
export const VAR_PATTERN = /\{\{[^{}\n]*\}\}/g

export const VAR_HELP: Record<VarType, string> = {
  text: 'text, quoted and escaped for you',
  number: 'number',
  date: 'date, as YYYY-MM-DD',
  ident: 'table or column name',
  list: 'comma-separated list',
  raw: 'inserted exactly as typed',
}

/** Stored as a variable's value to send SQL NULL. No typed value can equal it. */
export const NULL_VALUE = '\u0000NULL'

/** Types that have a NULL to send. A name or raw SQL does not. */
export const canBeNull = (type: VarType) => type === 'text' || type === 'number' || type === 'date'

/** Where a variable stands: in plain SQL, or already inside quotes that the query wrote itself. */
type Place =
  | { in: 'sql' }
  /** Inside a string literal: the value is inserted escaped, without quotes of its own. */
  | { in: 'string'; quote: string; backslash: boolean; raw?: boolean }
  /** Inside a quoted name such as [..] or "..". */
  | { in: 'name'; close: string }
  /** Inside a $$ ... $$ string, where nothing can be escaped. */
  | { in: 'dollar' }

interface Found {
  start: number
  end: number
  place: Place
  variable?: TemplateVar
  /** The type as written in this spelling, when it names one. */
  explicitType?: VarType
  /** Why the braces are not a usable variable. */
  problem?: string
}

const INNER = /^\s*([A-Za-z_]\w*)\s*(?::\s*([A-Za-z]+)\s*)?(?:=([^}]*))?$/

function placeOf(token: Token, dialect: Dialect): Place {
  const first = token.text[0]
  if (first === '$') return { in: 'dollar' }
  if (first === '[') return { in: 'name', close: ']' }
  if (first === '`') return { in: 'name', close: '`' }
  if (first === '"' && dialect !== 'mysql' && dialect !== 'databricks') return { in: 'name', close: '"' }
  // r'...' on Databricks is the one string there in which a backslash is only a backslash.
  if ((first === 'r' || first === 'R') && dialect === 'databricks') return { in: 'string', quote: token.text[1] === '"' ? '"' : "'", backslash: false, raw: true }
  // E'...' on Postgres, and every string on MySQL, Snowflake and Databricks, read a backslash as an escape.
  return { in: 'string', quote: first === '"' ? '"' : "'", backslash: backslashEscapes(dialect) || first === 'e' || first === 'E' }
}

/**
 * Finds every {{...}} outside comments, with where it stands. The shared scanner decides what is a
 * comment, a string or a quoted name, so an apostrophe in [it's] or a # comment cannot mislead it.
 */
function find(sql: string, dialect: Dialect): Found[] {
  const found: Found[] = []
  const take = (start: number, whole: string, place: Place) => {
    const match = INNER.exec(whole.slice(2, -2))
    const entry: Found = { start, end: start + whole.length, place }
    if (!match) entry.problem = `${whole} is not a valid variable. Names use letters, digits and underscores, like {{order_id}}`
    else if (match[2] && !(VAR_TYPES as readonly string[]).includes(match[2].toLowerCase())) {
      entry.problem = `${whole} has an unknown type "${match[2]}". Use one of: ${VAR_TYPES.join(', ')}`
    } else {
      entry.explicitType = match[2]?.toLowerCase() as VarType | undefined
      entry.variable = { name: match[1], type: entry.explicitType ?? 'text', default: match[3]?.trim() }
    }
    found.push(entry)
  }
  for (const token of scan(sql, dialect, { variables: true }).tokens) {
    if (token.kind === 'var') take(token.start, token.text, { in: 'sql' })
    else if (token.kind === 'string' || token.kind === 'quoted') {
      const place = placeOf(token, dialect)
      for (const m of token.text.matchAll(VAR_PATTERN)) take(token.start + m.index, m[0], place)
    }
  }
  return found
}

/**
 * The distinct variables in a query, in order of first appearance. Variables in comments are ignored.
 * Pass the dialect when it is known, so that database's comments and quotes are read correctly.
 */
export function parseVars(sql: string, dialect: Dialect = 'sqlite'): TemplateVar[] {
  const seen = new Map<string, TemplateVar>()
  for (const { variable } of find(sql, dialect)) {
    if (!variable) continue
    const existing = seen.get(variable.name)
    if (!existing) seen.set(variable.name, { ...variable })
    else if (existing.default === undefined && variable.default !== undefined) existing.default = variable.default
  }
  return [...seen.values()]
}

/** Splits `schema.table` into parts, respecting [brackets], "quotes" and `backticks` around names that contain dots. */
function identParts(name: string): string[] {
  const parts: string[] = []
  const pattern = /\[((?:[^\]]|\]\])*)\]|"((?:[^"]|"")*)"|`((?:[^`]|``)*)`|([^.]+)/g
  for (const m of name.trim().matchAll(pattern)) {
    parts.push((m[1]?.replace(/]]/g, ']') ?? m[2]?.replace(/""/g, '"') ?? m[3]?.replace(/``/g, '`') ?? m[4]).trim())
  }
  return parts.filter(Boolean)
}

export function quoteIdent(name: string, dialect: Dialect): string {
  // SQL Server's "database..table" leaves the schema out on purpose; keep the gap.
  const gap = dialect === 'mssql' ? /^([^.]+)\.\.([^.].*)$/.exec(name.trim()) : null
  if (gap) return `${quoteIdent(gap[1], dialect)}..${quoteIdent(gap[2], dialect)}`
  return identParts(name).map((part) => quoteName(part, dialect)).join('.')
}

const NUMBER = /^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i
// A number that reads back exactly as typed; "007" is an id, not seven.
const PLAIN_NUMBER = /^-?(0|[1-9]\d*)(\.\d+)?$/

/** Splits a pasted list on commas and new lines. An item in quotes may hold a comma, and is always text. */
function listItems(value: string): { text: string; quoted: boolean }[] {
  const items: { text: string; quoted: boolean }[] = []
  const pattern = /\s*(?:'((?:[^']|'')*)'|"((?:[^"]|"")*)"|([^,\n]*))\s*(?:[,\n]|$)/gy
  let m: RegExpExecArray | null
  while (pattern.lastIndex < value.length && (m = pattern.exec(value))) {
    if (m[1] !== undefined) items.push({ text: m[1].replace(/''/g, "'"), quoted: true })
    else if (m[2] !== undefined) items.push({ text: m[2].replace(/""/g, '"'), quoted: true })
    else if (m[3].trim()) items.push({ text: m[3].trim(), quoted: false })
    if (m[0] === '') break
  }
  return items
}

function renderValue(v: TemplateVar, value: string, dialect: Dialect, before: string): string | Error {
  switch (v.type) {
    case 'raw': return value
    case 'text': return quoteText(value, dialect)
    case 'number': {
      let n = value.trim().replace(/^\+/, '')
      if (!NUMBER.test(n)) return new Error(`${v.name} must be a number`)
      // ".5" and "5." are numbers to a person; not every database reads them.
      n = n.replace(/^(-?)\./, (_, sign: string) => `${sign}0.`).replace(/\.(e|$)/i, (_, rest: string) => rest)
      // Brackets only where "-{{n}}" with a negative value would otherwise read as a "--" comment; LIMIT and TOP need a bare number.
      return n.startsWith('-') && before.endsWith('-') ? `(${n})` : n
    }
    case 'date': return dateLiteral(value, dialect) ?? new Error(`${v.name} must be a real date like 2026-01-31`)
    case 'ident': return identParts(value).length > 0 && !/[;\n]/.test(value) ? quoteIdent(value, dialect) : new Error(`${v.name} must be a table or column name`)
    case 'list': {
      const items = listItems(value)
      if (items.length === 0) return new Error(`${v.name} needs at least one value`)
      // All numbers stay numbers; any text makes the whole list text, so the column is compared one way.
      const numeric = items.every((item) => !item.quoted && PLAIN_NUMBER.test(item.text))
      return items.map((item) => (numeric ? item.text : quoteText(item.text, dialect))).join(', ')
    }
  }
}

/** The value as it goes inside quotes the query already wrote. */
function renderInside(place: Exclude<Place, { in: 'sql' }>, v: TemplateVar, value: string, dialect: Dialect): string | Error {
  if (place.in === 'dollar') return new Error(`${v.name} is inside a $$ string, where a value cannot be made safe. Move it out of the string`)
  if (place.in === 'name') {
    if (/[\n]/.test(value)) return new Error(`${v.name} must be a table or column name`)
    return value.split(place.close).join(place.close + place.close)
  }
  // A raw string has no way to hold its own quote or end in a backslash.
  if (place.raw) return value.includes(place.quote) || value.endsWith('\\') ? new Error(`${v.name} is inside an r'...' string, which cannot hold that value. Use an ordinary string`) : value
  // Databricks escapes a quote with a backslash; doubling it would end the string and start another.
  if (place.quote === '"') return value.replace(/\\/g, '\\\\').replace(/"/g, dialect === 'databricks' ? '\\"' : '""')
  const escaped = escapeText(value, dialect)
  // Postgres doubles backslashes only in an E'...' string, which escapeText does not know about.
  return place.backslash && !backslashEscapes(dialect) ? escaped.replace(/\\/g, '\\\\') : escaped
}

/** Substitutes every variable. Values are escaped by type, so text can never break out of its quotes. */
export function renderSql(sql: string, values: Record<string, string>, dialect: Dialect): { sql: string; errors: string[] } {
  const all = find(sql, dialect)
  const declared = new Map(parseVars(sql, dialect).map((v) => [v.name, v]))
  const errors = new Set<string>()
  // One name written with two different types would be rendered one way and read the other.
  const types = new Map<string, Set<VarType>>()
  for (const f of all) if (f.variable && f.explicitType) types.set(f.variable.name, (types.get(f.variable.name) ?? new Set()).add(f.explicitType))
  for (const [name, set] of types) if (set.size > 1) errors.add(`${name} is written with more than one type (${[...set].join(', ')}). Use one`)

  let out = ''
  let at = 0
  for (const f of all) {
    out += sql.slice(at, f.start)
    at = f.end
    const whole = sql.slice(f.start, f.end)
    const fail = (problem: string) => { errors.add(problem); out += whole }
    if (!f.variable) { fail(f.problem!); continue }
    // The first spelling of a variable decides its type and default for every later use.
    const v = declared.get(f.variable.name)!
    const typed = values[v.name] ?? ''
    if (typed === NULL_VALUE) {
      if (f.place.in !== 'sql' || !canBeNull(v.type)) fail(`${v.name} cannot be NULL here`)
      else out += 'NULL'
      continue
    }
    const value = typed !== '' ? typed : v.default ?? ''
    // {{name=}} says an empty value is meant; without it an empty box is a forgotten one.
    const emptyMeant = typed === '' && v.default === '' && (v.type === 'text' || f.place.in !== 'sql')
    if (value === '' && !emptyMeant) { fail(`${v.name} is empty`); continue }
    if (value.includes('\0')) { fail(`${v.name} contains a character that cannot be sent to a database`); continue }
    const rendered = f.place.in === 'sql' ? renderValue(v, value, dialect, out) : renderInside(f.place, v, value, dialect)
    if (rendered instanceof Error) fail(rendered.message)
    else out += rendered
  }
  return { sql: out + sql.slice(at), errors: [...errors] }
}
