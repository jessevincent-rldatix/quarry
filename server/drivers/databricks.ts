import type { Cell, ColumnKind, ConnectionConfig, ResultColumn, ResultSet } from '../../shared/types.ts'
import { splitStatements } from '../../shared/sqlScan.ts'
import { buildSchema, emptyResult, isNumericKind, markCancelled, message } from './common.ts'
import type { Driver, DriverResult } from './types.ts'

// ── Databricks SQL ───────────────────────────────────────────────────────────
// Talks to a SQL warehouse through the Statement Execution API (plain HTTPS, no driver to install).
// The API takes one statement per call and each call is its own session, so a script is sent one
// statement at a time and nothing set by one (USE, SET, a temporary view) reaches the next.

const KINDS: Record<string, ColumnKind> = {
  BYTE: 'integer', SHORT: 'integer', INT: 'integer', LONG: 'integer', FLOAT: 'float', DOUBLE: 'float', DECIMAL: 'decimal',
  BOOLEAN: 'bool', DATE: 'date', TIMESTAMP: 'date', TIMESTAMP_NTZ: 'date', BINARY: 'binary', ARRAY: 'json', MAP: 'json', STRUCT: 'json',
  VARIANT: 'json', STRING: 'text', CHAR: 'text', INTERVAL: 'text',
}

/** A result column as the API describes it. */
export interface DatabricksColumn {
  name: string
  /** The type's family, in capitals: LONG, DECIMAL, STRING. */
  type_name?: string
  /** The type as SQL writes it: bigint, decimal(10,2). */
  type_text?: string
}

export function databricksColumn(column: DatabricksColumn): ResultColumn {
  const kind = KINDS[(column.type_name ?? '').toUpperCase()]
  return { name: column.name, type: (column.type_text ?? column.type_name ?? '').toLowerCase(), ...(isNumericKind(kind) ? { numeric: true } : {}), ...(kind ? { kind } : {}) }
}

/** Every value arrives as text. Numbers that a JavaScript number holds exactly become numbers; the rest stay as written. */
export function databricksCell(value: unknown, kind: ColumnKind | undefined): Cell {
  if (value === null || value === undefined) return null
  if (typeof value !== 'string') return typeof value === 'number' || typeof value === 'boolean' ? value : JSON.stringify(value)
  if (kind === 'bool') return value === 'true' ? true : value === 'false' ? false : value
  if (kind === 'integer') return Number.isSafeInteger(Number(value)) ? Number(value) : value
  // NaN and Infinity are valid here and have no JSON number; they stay as the words the database sent.
  if (kind === 'float') return Number.isFinite(Number(value)) ? Number(value) : value
  return value
}

interface StatementResponse {
  statement_id?: string
  status?: { state?: string; error?: { error_code?: string; message?: string } }
  manifest?: { schema?: { columns?: DatabricksColumn[] }; truncated?: boolean }
  result?: ResultChunk
  /** Present on a refused request. */
  message?: string
  error_code?: string
}

interface ResultChunk {
  data_array?: unknown[][]
  next_chunk_internal_link?: string
}

const WORKING = new Set(['PENDING', 'RUNNING'])
/** How long each request waits for the statement before answering "still running". */
const WAIT = '10s'
const POLL_MS = 600
/** A result sent in the reply itself may not pass 25 MiB, or the statement fails. This cuts it short well before that. */
const BYTE_LIMIT = 16 * 1024 * 1024

/** The warehouse id from an HTTP path such as /sql/1.0/warehouses/abc123, or the id itself. */
export const warehouseId = (httpPath: string) => httpPath.trim().replace(/\/+$/, '').split('/').pop() ?? ''

export async function databricksDriver(config: ConnectionConfig, token: string): Promise<Driver> {
  const host = (config.host ?? '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const warehouse = warehouseId(config.httpPath ?? '')
  if (!host) throw new Error('Give the workspace host, such as adb-1234567890123456.7.azuredatabricks.net.')
  if (!warehouse) throw new Error('Give the SQL warehouse\'s HTTP path. It is on the warehouse\'s "Connection details" tab and looks like /sql/1.0/warehouses/abc123.')
  if (!token) throw new Error('Give a personal access token.')
  // A local address is allowed over http so the driver can be tried against a stand-in server.
  const base = `${/^(127\.0\.0\.1|localhost)(:\d+)?$/.test(host) ? 'http' : 'https'}://${host}`

  async function call(path: string, body?: unknown, signal?: AbortSignal): Promise<StatementResponse> {
    let response: Response
    try {
      response = await fetch(`${base}${path}`, {
        method: body === undefined ? 'GET' : 'POST',
        headers: { authorization: `Bearer ${token}`, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      })
    } catch (err) {
      if (signal?.aborted) throw err
      throw new Error(`Could not reach ${host}: ${message(err)}`)
    }
    const text = await response.text()
    let parsed: StatementResponse = {}
    try { parsed = text ? JSON.parse(text) as StatementResponse : {} } catch { /* an error page, not JSON */ }
    if (!response.ok) {
      const hint = response.status === 401 || response.status === 403 ? ' Check the access token.' : response.status === 404 ? ' Check the host and the warehouse path.' : ''
      throw new Error(`Databricks answered ${response.status}: ${parsed.message ?? text.slice(0, 300)}${hint}`)
    }
    return parsed
  }

  const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms))

  /** Runs one statement to its end. Cancels it on the warehouse if the signal fires. */
  async function execute(sql: string, rowLimit: number | undefined, signal?: AbortSignal): Promise<StatementResponse> {
    let id: string | undefined
    const cancel = () => { if (id) void call(`/api/2.0/sql/statements/${id}/cancel`, {}).catch(() => undefined) }
    signal?.addEventListener('abort', cancel)
    try {
      let reply = await call('/api/2.0/sql/statements', {
        statement: sql,
        warehouse_id: warehouse,
        ...(config.database ? { catalog: config.database } : {}),
        ...(config.schema ? { schema: config.schema } : {}),
        wait_timeout: WAIT,
        on_wait_timeout: 'CONTINUE',
        disposition: 'INLINE',
        format: 'JSON_ARRAY',
        ...(rowLimit ? { row_limit: rowLimit, byte_limit: BYTE_LIMIT } : {}),
      }, signal)
      id = reply.statement_id
      // The stop may have come while the first request was on its way.
      if (signal?.aborted) cancel()
      while (id && WORKING.has(reply.status?.state ?? '')) {
        if (signal?.aborted) break
        await pause(POLL_MS)
        reply = await call(`/api/2.0/sql/statements/${id}`, undefined, signal)
      }
      return reply
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
  }

  /** The rows of a finished statement, following its further pieces when the result came in several. */
  async function* rowsOf(reply: StatementResponse, signal?: AbortSignal): AsyncGenerator<unknown[]> {
    let chunk = reply.result
    while (chunk) {
      for (const row of chunk.data_array ?? []) yield row
      if (!chunk.next_chunk_internal_link) return
      chunk = await call(chunk.next_chunk_internal_link, undefined, signal) as ResultChunk
    }
  }

  const run = async (sql: string, maxRows: number, signal?: AbortSignal): Promise<DriverResult> => {
    const result = emptyResult()
    for (const statement of splitStatements(sql, 'databricks')) {
      if (signal?.aborted) { markCancelled(result); break }
      let reply: StatementResponse
      try {
        // One row past the limit is asked for, which is how a cut-off result is told from one that just fits.
        reply = await execute(statement.sql, maxRows + 1, signal)
      } catch (err) {
        if (signal?.aborted) { markCancelled(result); break }
        result.error = { message: message(err) }
        break
      }
      const state = reply.status?.state
      if (signal?.aborted || state === 'CANCELED' || state === 'CANCELLED') { markCancelled(result); break }
      if (state !== 'SUCCEEDED') {
        const text = reply.status?.error?.message ?? `The statement ended as ${state ?? 'unknown'}.`
        // "... (line 3, pos 7)" counts lines within the one statement that was sent.
        const at = /\(line (\d+), pos \d+\)/.exec(text)
        result.error = { message: text, ...(at ? { line: Number(at[1]) + statement.line - 1 } : {}) }
        break
      }
      const columns = (reply.manifest?.schema?.columns ?? []).map(databricksColumn)
      if (columns.length === 0) continue
      // The warehouse says so itself when the size limit, or the one row asked for past the row limit, cut the result short.
      const set: ResultSet = { columns, rows: [], truncated: reply.manifest?.truncated === true }
      try {
        for await (const row of rowsOf(reply, signal)) {
          if (set.rows.length >= maxRows) { set.truncated = true; break }
          set.rows.push(row.map((value, i) => databricksCell(value, columns[i]?.kind)))
        }
      } catch (err) {
        if (signal?.aborted) markCancelled(result)
        else result.error = { message: message(err) }
      }
      // A statement that changes rows answers with their count instead of rows of its own.
      if (columns[0].name === 'num_affected_rows' && set.rows.length === 1) {
        result.rowsAffected = (result.rowsAffected ?? 0) + (Number(set.rows[0][0]) || 0)
      } else {
        result.resultSets.push(set)
      }
      if (result.error || result.stopped) break
    }
    return result
  }

  /** Rows of a catalog query, or nothing when this workspace does not have that view. */
  const rows = async (sql: string): Promise<Cell[][]> => {
    const reply = await execute(sql, undefined)
    if (reply.status?.state !== 'SUCCEEDED') throw new Error(reply.status?.error?.message ?? 'The schema could not be read.')
    const found: Cell[][] = []
    for await (const row of rowsOf(reply)) found.push(row.map((value) => (value === null || value === undefined ? null : String(value))))
    return found
  }

  return {
    query: run,
    async schema() {
      // information_schema belongs to a Unity Catalog catalog; with none chosen, the one the warehouse starts in is used.
      const columns = await rows(`
        SELECT c.table_schema, c.table_name, t.table_type, c.column_name, c.full_data_type, c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_catalog = c.table_catalog AND t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema <> 'information_schema'
        ORDER BY c.table_schema, c.table_name, c.ordinal_position`)
      // Keys are optional in Databricks and many workspaces have none; a failure here must not hide the tables.
      const keys = await rows(`
        SELECT tc.constraint_type, k.table_schema, k.table_name, k.column_name, r.table_schema, r.table_name, r.column_name
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage k
          ON k.constraint_catalog = tc.constraint_catalog AND k.constraint_schema = tc.constraint_schema AND k.constraint_name = tc.constraint_name
        LEFT JOIN information_schema.referential_constraints rc
          ON rc.constraint_catalog = tc.constraint_catalog AND rc.constraint_schema = tc.constraint_schema AND rc.constraint_name = tc.constraint_name
        LEFT JOIN information_schema.key_column_usage r
          ON r.constraint_catalog = rc.unique_constraint_catalog AND r.constraint_schema = rc.unique_constraint_schema
         AND r.constraint_name = rc.unique_constraint_name AND r.ordinal_position = k.position_in_unique_constraint
        WHERE tc.constraint_type IN ('PRIMARY KEY', 'FOREIGN KEY')`).catch(() => [] as Cell[][])
      const primary = new Set(keys.filter((k) => k[0] === 'PRIMARY KEY').map((k) => `${k[1]}\u0000${k[2]}\u0000${k[3]}`))
      const foreign = keys.filter((k) => k[0] === 'FOREIGN KEY' && k[5] !== null).map((k) => k.slice(1))
      return buildSchema(columns.map((c) => [...c, primary.has(`${c[0]}\u0000${c[1]}\u0000${c[3]}`)]), foreign)
    },
    async close() { /* nothing is held open between requests */ },
  }
}
