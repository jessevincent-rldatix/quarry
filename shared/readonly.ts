import { scan, type Token } from './sqlScan.ts'
import type { Dialect } from './types.ts'

export { scan, splitBatches, stripComments, type Scan, type Token } from './sqlScan.ts'

// A read-only batch may only start its statements with these.
const READ_STARTS = new Set(['select', 'with', 'explain', 'show', 'describe', 'desc', 'pragma', 'values', 'table'])
// T-SQL scaffolding that everyday read scripts use.
const TSQL_STARTS = new Set(['set', 'declare', 'print', 'if', 'else', 'begin', 'end', 'while', 'use', 'go', 'exec', 'execute', 'rollback', 'raiserror', 'return'])

// Snowflake and Databricks: choosing the warehouse, database or schema changes nothing but this session.
const CLOUD_STARTS = new Set(['use', 'list', 'ls'])
// Snowflake system functions that only report. Others can stop queries, change settings or send messages.
const READ_SYSTEM_FUNCTIONS = /^system\$(clustering_information|clustering_depth|typeof|last_change_commit_time|stream_has_data|pipe_status|explain_plan_json|explain_json_to_text|estimate_\w+|get_\w+)$/

// These make a batch a write wherever they appear, because a statement can hide inside a CTE or
// after a SELECT (SELECT ... INTO, WITH x AS (DELETE ...), EXPLAIN ANALYZE of a write).
const WRITE_WORDS = new Set(['insert', 'update', 'delete', 'merge', 'drop', 'alter', 'create', 'truncate', 'grant', 'revoke', 'into', 'commit',
  'default_transaction_read_only', 'transaction_read_only'])
// T-SQL needs no semicolon between statements, so its statement keywords are checked everywhere too.
const TSQL_WRITE_WORDS = new Set(['deny', 'backup', 'restore', 'dbcc', 'shutdown', 'kill', 'bulk', 'openrowset', 'opendatasource', 'openquery',
  'reconfigure', 'checkpoint', 'writetext', 'updatetext', 'waitfor', 'implicit_transactions', 'xp_cmdshell'])

// Stored procedures that only report on the database.
const READ_PROCEDURES = /^(sys\.)?sp_(help\w*|who2?|columns|tables|spaceused|pkeys|fkeys|statistics|describe_first_result_set|databases|server_info|stored_procedures)$/

// SQLite pragmas that take an argument and still only read.
const READ_PRAGMAS = new Set(['table_info', 'table_xinfo', 'table_list', 'index_list', 'index_info', 'index_xinfo', 'foreign_key_list'])

const isWord = (t: Token | undefined, ...texts: string[]) => t?.kind === 'word' && texts.includes(t.text)
const isPunct = (t: Token | undefined, text: string) => t?.kind === 'punct' && t.text === text

/**
 * Checks a batch for a read-only connection. Returns the reason it is refused, or null.
 *
 * This is a guard against mistakes. The database login is what truly limits what can change, so
 * use a login that only has read permission when the data must not be touched.
 */
export function readOnlyViolation(sql: string, dialect: Dialect): string | null {
  const refuse = (what: string) => `This connection is read-only. ${what}`
  const { tokens, unterminated } = scan(sql, dialect)
  if (unterminated) return refuse(`The query has an unfinished ${unterminated}, so it cannot be checked.`)
  // MySQL runs the contents of /*! ... */ as SQL, so what looks like a comment may not be one.
  if (dialect === 'mysql' && /\/\*M?!/.test(sql)) return refuse('It contains a /*! ... */ comment, which MySQL runs as SQL.')

  let atStart = true
  // SHOW and DESCRIBE only report, whatever words follow: SHOW CREATE TABLE, SHOW transaction_read_only.
  let reporting = false
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind === 'punct') {
      if (t.text === ';') { atStart = true; reporting = false }
      continue
    }
    if (t.kind !== 'word') { atStart = false; continue }
    const next = tokens[i + 1]
    const previous = tokens[i - 1]

    if (atStart) {
      atStart = false
      const cloud = dialect === 'snowflake' || dialect === 'databricks'
      if (!READ_STARTS.has(t.text) && !(dialect === 'mssql' && TSQL_STARTS.has(t.text)) && !(cloud && CLOUD_STARTS.has(t.text))) return refuse(`${t.text.toUpperCase()} statements are not allowed on it.`)
      // These databases need a semicolon before the next statement, so nothing else can follow in this one.
      if (dialect !== 'mssql' && dialect !== 'sqlite' && (t.text === 'show' || t.text === 'describe' || t.text === 'desc' || (cloud && CLOUD_STARTS.has(t.text)))) reporting = true
      if (t.text === 'pragma') {
        const name = next?.kind === 'word' ? next.text : ''
        const after = tokens[i + 2]
        if (after?.kind === 'punct' && (after.text === '=' || (after.text === '(' && !READ_PRAGMAS.has(name)))) {
          return refuse('This PRAGMA changes a setting.')
        }
      }
    }
    if (reporting) continue
    if (t.text === 'exec' || t.text === 'execute') {
      // Collect a dotted procedure name such as sys.sp_help.
      let name = ''
      for (let k = i + 1; k < tokens.length; k++) {
        const part = tokens[k]
        if (part.kind === 'word' || (part.kind === 'punct' && part.text === '.')) name += part.text
        else break
      }
      if (!READ_PROCEDURES.test(name)) return refuse('Running a stored procedure may change data.')
      continue
    }
    // A sequence moves on even when the transaction around it is rolled back, so reading one is a write.
    if (t.text === 'next' && isWord(next, 'value') && isWord(tokens[i + 2], 'for')) return refuse('NEXT VALUE FOR advances a sequence, and that cannot be rolled back.')
    if ((t.text === 'nextval' || t.text === 'setval') && isPunct(next, '(')) return refuse(`${t.text.toUpperCase()} changes a sequence, and that cannot be rolled back.`)
    // Snowflake writes it after the sequence's name: my_sequence.NEXTVAL.
    if (dialect === 'snowflake' && t.text === 'nextval' && isPunct(previous, '.')) return refuse('NEXTVAL advances a sequence, and that cannot be rolled back.')
    if (dialect === 'snowflake' && t.text.startsWith('system$') && !READ_SYSTEM_FUNCTIONS.test(t.text)) return refuse(`${t.text.toUpperCase()} can change settings or running queries.`)
    if (dialect === 'mssql' && t.text === 'raiserror') {
      for (let k = i + 1; k < tokens.length && !isPunct(tokens[k], ';'); k++) {
        if (isWord(tokens[k], 'with') && isWord(tokens[k + 1], 'log')) return refuse('RAISERROR ... WITH LOG writes to the server log.')
      }
    }
    if (dialect === 'mssql' && TSQL_WRITE_WORDS.has(t.text)) return refuse(`The query contains ${t.text.toUpperCase()}, which can change data or settings.`)
    if (WRITE_WORDS.has(t.text)) {
      // The same words are harmless in a few places: a join or union hint, a function call, a column of that name.
      const hint = t.text === 'merge' && isWord(next, 'join', 'union')
      const call = t.text === 'insert' && isPunct(next, '(')
      // Only where a keyword is allowed after a dot. SQL Server needs no semicolons, so "1. DELETE ..." must stay refused there.
      const member = dialect !== 'mssql' && isPunct(previous, '.') && previous!.start + 1 === t.start && tokens[i - 2]?.kind !== 'punct'
      if (!hint && !call && !member) return refuse(`The query contains ${t.text.toUpperCase()}, which can change data or settings.`)
    }
    if (t.text === 'replace' && isWord(next, 'into')) return refuse('REPLACE INTO changes data.')
    if (t.text === 'read' && isWord(next, 'write')) return refuse('READ WRITE would switch off read-only mode.')
    if (t.text === 'for' && isWord(next, 'update', 'share')) return refuse('Row locks are not allowed on it.')
  }
  return null
}

// A new statement starts at any of these, so an UPDATE or DELETE before it has ended. T-SQL needs no semicolon between statements.
// Left out on purpose, because they also appear inside an UPDATE: WITH (table hints), END (of a CASE), IF (a function), USE (index hints).
const STATEMENT_STARTS = ['update', 'delete', 'insert', 'merge', 'truncate', 'drop', 'go', 'select', 'exec', 'execute', 'declare', 'print',
  'begin', 'while', 'return', 'create', 'alter', 'grant', 'commit', 'rollback']
// "ON UPDATE CASCADE", "WHEN MATCHED THEN UPDATE", "ON CONFLICT ... DO UPDATE", "ON DUPLICATE KEY UPDATE", "AFTER UPDATE OR DELETE ON": not statements.
const NOT_A_STATEMENT_AFTER = ['on', 'then', 'do', 'key', 'for', 'after', 'before', 'of', 'or']

/**
 * Finds a statement worth a second look before it runs on a writable connection: an UPDATE or
 * DELETE with no WHERE of its own, a DROP, or a TRUNCATE. Returns a short description, or null.
 */
export function riskyWrite(sql: string, dialect: Dialect): string | null {
  const { tokens } = scan(sql, dialect)
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i]
    if (t.kind !== 'word') continue
    if (t.text === 'truncate') return 'TRUNCATE empties the whole table'
    if (t.text === 'drop' && tokens[i + 1]?.kind === 'word') return `DROP ${tokens[i + 1].text.toUpperCase()} cannot be undone`
    if ((t.text !== 'delete' && t.text !== 'update') || isWord(tokens[i - 1], ...NOT_A_STATEMENT_AFTER)) continue
    // The statement runs until a semicolon or the start of the next statement at the same depth.
    let hasWhere = false
    for (let k = i + 1; k < tokens.length; k++) {
      const u = tokens[k]
      if (u.depth < t.depth) break
      if (u.depth > t.depth) continue
      if (u.kind === 'punct' && u.text === ';') break
      if (isWord(u, ...STATEMENT_STARTS) && !isWord(tokens[k - 1], ...NOT_A_STATEMENT_AFTER)) break
      if (isWord(u, 'where', 'top', 'limit')) { hasWhere = true; break }
    }
    if (!hasWhere) return `${t.text.toUpperCase()} with no WHERE affects every row`
  }
  return null
}
