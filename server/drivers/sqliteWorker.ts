import fs from 'node:fs'
import { parentPort, workerData } from 'node:worker_threads'
import type { Cell, ResultSet, SchemaTable } from '../../shared/types.ts'
import { seedDemo } from '../demo.ts'
import { buildSchema, emptyResult, isNumericKind, lineAt, message, require, RowCollector, toCell, ValueKinds } from './common.ts'
import type { DriverResult } from './types.ts'

/**
 * Runs SQLite on its own thread. SQLite here is synchronous, so on the main thread one slow query
 * would hold up every other connection until it finished, and could not be stopped.
 */
export type SqliteCommand = { kind: 'query'; sql: string; maxRows: number } | { kind: 'schema' }
export type SqliteRequest = SqliteCommand & { id: number }
export type SqliteReply = { id: number; result?: DriverResult; schema?: SchemaTable[]; error?: string }

const settings = workerData as { builtin: boolean; file: string }
const initSqlJs = require('sql.js') as typeof import('sql.js').default
const SQL = await initSqlJs()
const db = settings.builtin ? new SQL.Database() : new SQL.Database(fs.readFileSync(settings.file))
if (settings.builtin) seedDemo(db)

// What this file relies on from sql.js beyond its published types.
type Statement = { getColumnNames(): string[]; step(): boolean; get(params?: null, config?: { useBigInt: boolean }): unknown[]; getSQL(): string }
/** Walks a script one statement at a time, and can say what text is left when one fails. */
interface StatementWalker { iterateStatements(sql: string): Iterable<Statement> & { getRemainingSQL(): string } }
const statements = (sql: string) => (db as unknown as StatementWalker).iterateStatements(sql)

function query(sql: string, maxRows: number): DriverResult {
  const result = emptyResult()
  const collector = new RowCollector(result, maxRows)
  const iterator = statements(sql)
  try {
    for (const statement of iterator) {
      const text = statement.getSQL()
      const columns = statement.getColumnNames()
      if (columns.length > 0) {
        const set: ResultSet = { columns: columns.map((name) => ({ name, type: '' })), rows: [], truncated: false }
        // SQLite does not say what type an expression is, so each column is judged by the values it returned.
        const kinds = columns.map(() => new ValueKinds())
        // Stepping row by row means a huge result is never held in memory beyond the limit. Nothing is
        // being sent from elsewhere, so one row past the limit is enough to know there were more.
        while (statement.step()) {
          const pushed = collector.push(set, () => statement.get(null, { useBigInt: true }).map((value, i) => {
            kinds[i].add(value)
            return toCell(value)
          }))
          if (pushed !== 'kept') break
        }
        set.columns = columns.map((name, i) => {
          const kind = kinds[i].kind()
          return { name, type: '', ...(isNumericKind(kind) ? { numeric: true } : {}), ...(kind ? { kind } : {}) }
        })
        result.resultSets.push(set)
      } else {
        statement.step()
        if (/^\s*(insert|update|delete|replace)\b/i.test(text)) result.rowsAffected = (result.rowsAffected ?? 0) + db.getRowsModified()
      }
    }
    if (!settings.builtin && result.rowsAffected !== null) {
      result.messages.push('Changes apply to the in-memory snapshot only; the file on disk is not modified.')
    }
  } catch (err) {
    const rest = iterator.getRemainingSQL()
    const start = sql.length - rest.length + (rest.length - rest.trimStart().length)
    result.error = { message: message(err), line: lineAt(sql, start) }
  }
  return result
}

function schema(): SchemaTable[] {
  const columns = db.exec(`
    SELECT '' AS s, m.name, m.type, p.name, p.type, CASE WHEN p."notnull" = 0 THEN 1 ELSE 0 END, CASE WHEN p.pk > 0 THEN 1 ELSE 0 END
    FROM sqlite_master m JOIN pragma_table_info(m.name) p
    WHERE m.type IN ('table', 'view') AND m.name NOT LIKE 'sqlite_%'
    ORDER BY m.name, p.cid`)
  const keys = db.exec(`
    SELECT '' AS s, m.name, f."from", '' AS rs, f."table", COALESCE(f."to", (SELECT p.name FROM pragma_table_info(f."table") p WHERE p.pk = 1))
    FROM sqlite_master m JOIN pragma_foreign_key_list(m.name) f
    WHERE m.type = 'table'`)
  return buildSchema((columns[0]?.values ?? []) as Cell[][], (keys[0]?.values ?? []) as Cell[][])
}

parentPort!.on('message', (request: SqliteRequest) => {
  let reply: SqliteReply
  try {
    reply = request.kind === 'query' ? { id: request.id, result: query(request.sql, request.maxRows) } : { id: request.id, schema: schema() }
  } catch (err) {
    reply = { id: request.id, error: message(err) }
  }
  parentPort!.postMessage(reply)
})
parentPort!.postMessage({ id: 0 } satisfies SqliteReply)
