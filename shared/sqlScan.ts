import { backslashEscapes } from './dialect.ts'
import type { Dialect } from './types.ts'

/**
 * The one SQL scanner. It knows each database's quoting and comment rules, so that keywords
 * inside strings, quoted names and comments are never mistaken for statements, and so that a
 * quote character cannot be used to hide the rest of a batch. The read-only guard, the
 * variables, "run statement at cursor" and the GO splitter all read SQL through it.
 */
export interface Token {
  /**
   * `word` is a bare keyword or name; `quoted` a quoted name; `string` a literal; `punct` one symbol;
   * `var` a whole {{variable}}, only produced when the scan is asked for them.
   */
  kind: 'word' | 'quoted' | 'string' | 'punct' | 'var'
  text: string
  /** Nesting depth of parentheses at this token. */
  depth: number
  start: number
}

export interface Scan {
  tokens: Token[]
  /** Set when the text ends inside a string, quoted name or comment: it cannot be classified safely. */
  unterminated: string | null
  /** The text with comments removed and other content left in place. */
  withoutComments: string
}

export interface ScanOptions {
  /** Treat {{...}} as one token, and do not let a quote inside one start or end a string. */
  variables?: boolean
}

const VARIABLE = /^\{\{[^{}\n]*\}\}/

export function scan(sql: string, dialect: Dialect, options: ScanOptions = {}): Scan {
  const tokens: Token[] = []
  let out = ''
  let i = 0
  let depth = 0
  let unterminated: string | null = null
  const n = sql.length
  const nested = dialect === 'postgres' || dialect === 'mssql' || dialect === 'databricks'
  const backslash = backslashEscapes(dialect)
  // On MySQL and Databricks double quotes hold a string; elsewhere they quote a name.
  const doubleQuotedText = dialect === 'mysql' || dialect === 'databricks'
  const variableAt = (at: number) => (options.variables && sql[at] === '{' && sql[at + 1] === '{' ? VARIABLE.exec(sql.slice(at, at + 400))?.[0] : undefined)

  /** Reads to the closing quote. `from` is where the token starts, which is before the quote for E'...'. */
  const readQuoted = (close: string, kind: 'quoted' | 'string', what: string, allowBackslash: boolean, from = i) => {
    i++
    while (i < n) {
      const variable = variableAt(i)
      if (variable) { i += variable.length; continue }
      if (allowBackslash && sql[i] === '\\') { i += 2; continue }
      if (sql[i] === close) {
        if (sql[i + 1] === close) { i += 2; continue }
        i++
        tokens.push({ kind, text: sql.slice(from, i), depth, start: from })
        out += sql.slice(from, i)
        return
      }
      i++
    }
    unterminated = what
    i = n
    // Still a token, so a variable inside a string that is being typed is found.
    tokens.push({ kind, text: sql.slice(from), depth, start: from })
    out += sql.slice(from)
  }

  while (i < n) {
    const ch = sql[i]
    const two = sql.slice(i, i + 2)
    const variable = variableAt(i)
    if (variable) {
      tokens.push({ kind: 'var', text: variable, depth, start: i })
      out += variable
      i += variable.length
    } else if (two === '--' || (dialect === 'mysql' && ch === '#') || (dialect === 'snowflake' && two === '//')) {
      while (i < n && sql[i] !== '\n') i++
      out += ' '
    } else if (two === '/*') {
      let level = 1
      i += 2
      while (i < n && level > 0) {
        if (nested && sql.slice(i, i + 2) === '/*') { level++; i += 2 }
        else if (sql.slice(i, i + 2) === '*/') { level--; i += 2 }
        else i++
      }
      if (level > 0) unterminated = 'comment'
      out += ' '
    } else if (ch === "'") {
      readQuoted("'", 'string', 'string', backslash)
    } else if (ch === '"') {
      readQuoted('"', doubleQuotedText ? 'string' : 'quoted', 'quoted name', doubleQuotedText && backslash)
    } else if (ch === '`' && (dialect === 'mysql' || dialect === 'sqlite' || dialect === 'databricks')) {
      readQuoted('`', 'quoted', 'quoted name', false)
    } else if (ch === '[' && (dialect === 'mssql' || dialect === 'sqlite')) {
      readQuoted(']', 'quoted', 'bracketed name', false)
    } else if (ch === '$' && (dialect === 'postgres' ? /^\$[A-Za-z_]*\$/.test(sql.slice(i, i + 64)) : dialect === 'snowflake' && two === '$$')) {
      // Postgres allows a tag between the dollars; Snowflake has only the plain $$ ... $$.
      const tag = dialect === 'snowflake' ? '$$' : /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 64))![0]
      const end = sql.indexOf(tag, i + tag.length)
      const start = i
      if (end === -1) { unterminated = 'dollar-quoted string'; i = n }
      else i = end + tag.length
      tokens.push({ kind: 'string', text: sql.slice(start, i), depth, start })
      out += sql.slice(start, i)
    } else if ((ch === 'e' || ch === 'E') && sql[i + 1] === "'" && dialect === 'postgres' && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? '')) {
      // E'...' is the one Postgres string in which a backslash escapes the next character.
      const from = i
      i++
      readQuoted("'", 'string', 'string', true, from)
    } else if ((ch === 'r' || ch === 'R') && (sql[i + 1] === "'" || sql[i + 1] === '"') && dialect === 'databricks' && !/[A-Za-z0-9_$]/.test(sql[i - 1] ?? '')) {
      // r'...' is the Databricks string in which a backslash is just a backslash.
      const from = i
      i++
      readQuoted(sql[i], 'string', 'string', false, from)
    } else if (/[A-Za-z_@#]/.test(ch)) {
      const start = i
      while (i < n && /[A-Za-z0-9_@#$]/.test(sql[i])) i++
      tokens.push({ kind: 'word', text: sql.slice(start, i).toLowerCase(), depth, start })
      out += sql.slice(start, i)
    } else if (/\s/.test(ch) || /[0-9.]/.test(ch)) {
      // A dot between names matters to the guard; one inside a number does not.
      if (ch === '.' && !/[0-9]/.test(sql[i + 1] ?? '')) tokens.push({ kind: 'punct', text: ch, depth, start: i })
      out += ch
      i++
    } else {
      if (ch === ')') depth = Math.max(0, depth - 1)
      tokens.push({ kind: 'punct', text: ch, depth, start: i })
      if (ch === '(') depth++
      out += ch
      i++
    }
  }
  return { tokens, unterminated, withoutComments: out }
}

/** Removes comments, respecting the dialect's quoting. */
export const stripComments = (sql: string, dialect: Dialect) => scan(sql, dialect).withoutComments

export interface Batch { sql: string; line: number; start: number; end: number }

/**
 * Splits a SQL Server script on GO lines, the way SSMS does. Each batch carries the line it
 * started on so an error can be reported against the whole script.
 */
export function splitBatches(sql: string): Batch[] {
  const lines = sql.split('\n')
  // GO only counts on its own line, outside strings and comments.
  const { tokens } = scan(sql, 'mssql')
  const lineStarts: number[] = [0]
  for (let i = 0; i < sql.length; i++) if (sql[i] === '\n') lineStarts.push(i + 1)
  const goLines = new Set<number>()
  for (const t of tokens) {
    if (t.kind !== 'word' || t.text !== 'go') continue
    let line = 0
    while (line + 1 < lineStarts.length && lineStarts[line + 1] <= t.start) line++
    if (/^\s*go(\s+\d+)?\s*;?\s*$/i.test(lines[line])) goLines.add(line)
  }
  const batches: Batch[] = []
  let first = 0
  for (let line = 0; line <= lines.length; line++) {
    if (line === lines.length || goLines.has(line)) {
      const start = lineStarts[first] ?? sql.length
      const end = line === lines.length ? sql.length : lineStarts[line]
      const text = sql.slice(start, end).replace(/\r?\n$/, '')
      if (text.trim()) batches.push({ sql: text, line: first + 1, start, end: start + text.length })
      first = line + 1
    }
  }
  return batches
}

const isWord = (t: Token | undefined, ...texts: string[]) => t?.kind === 'word' && texts.includes(t.text)

// After BEGIN, these mean a transaction is starting, not a block of statements.
const TRANSACTION_WORDS = ['transaction', 'tran', 'work', 'distributed', 'deferred', 'immediate', 'exclusive', 'isolation', 'read']
// END IF, END LOOP and friends close a statement that BEGIN did not open.
const END_OF_OTHER = ['if', 'loop', 'while', 'repeat']

/**
 * Where each top-level statement ends: the offsets of the semicolons that are not inside brackets,
 * a BEGIN ... END block or a CASE. A trigger or procedure body therefore stays in one piece.
 */
export function statementEnds(sql: string, dialect: Dialect): number[] {
  const { tokens } = scan(sql, dialect)
  const ends: number[] = []
  let block = 0
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    const next = tokens[i + 1]
    if (t.kind === 'punct' && t.text === ';' && t.depth === 0 && block === 0) ends.push(t.start)
    if (t.kind !== 'word') continue
    if (t.text === 'case') block++
    else if (t.text === 'begin' && next && !(next.kind === 'punct' && next.text === ';') && !isWord(next, ...TRANSACTION_WORDS)) block++
    else if (t.text === 'end' && !isWord(next, ...END_OF_OTHER)) block = Math.max(0, block - 1)
  }
  return ends
}

export interface Statement { sql: string; line: number }

/**
 * A script as its separate statements, for a database that takes one at a time. Each carries the
 * line it starts on, so an error can be reported against the whole script. Pieces that hold only
 * comments or blank space are left out.
 */
export function splitStatements(sql: string, dialect: Dialect): Statement[] {
  const statements: Statement[] = []
  let from = 0
  for (const end of [...statementEnds(sql, dialect), sql.length]) {
    const piece = sql.slice(from, end)
    const lead = piece.length - piece.trimStart().length
    if (scan(piece, dialect).tokens.length > 0) statements.push({ sql: piece.trim(), line: sql.slice(0, from + lead).split('\n').length })
    from = end + 1
  }
  return statements
}

/**
 * The statement the cursor is in. On SQL Server a GO line always separates statements, and the
 * text between two semicolons is otherwise the unit; a cursor just after a semicolon still means
 * the statement that semicolon ends.
 */
export function statementAt(sql: string, offset: number, dialect: Dialect): { text: string; line: number } {
  let from = 0
  let to = sql.length
  if (dialect === 'mssql') {
    const batches = splitBatches(sql)
    // The cursor on a GO line or a blank line belongs to the batch above it.
    const batch = [...batches].reverse().find((b) => b.start <= offset) ?? batches[0]
    if (batch) { from = batch.start; to = batch.end }
  }
  const text = sql.slice(from, to)
  const at = Math.min(Math.max(offset - from, 0), text.length)
  const breaks = statementEnds(text, dialect)
  const before = breaks.filter((b) => b < at - 1 || (b < at && text.slice(b + 1, at).trim() !== ''))
  let start = before.length ? before[before.length - 1] + 1 : 0
  const next = breaks.find((b) => b >= start && b >= at - 1)
  const end = next === undefined ? text.length : next + 1
  start += text.slice(start, end).length - text.slice(start, end).trimStart().length
  return { text: text.slice(start, end), line: sql.slice(0, from + start).split('\n').length }
}
