import { splitBatches } from '../../shared/readonly.ts'
import type { Cell, ColumnKind, ConnectionConfig, ResultSet } from '../../shared/types.ts'
import { buildSchema, emptyResult, isNumericKind, markCancelled, message, ROLLED_BACK, RowCollector, toCell } from './common.ts'
import type { Driver, DriverResult } from './types.ts'

// ── SQL Server ───────────────────────────────────────────────────────────────

// What this file relies on from the mssql library beyond its published types.

/** A column as announced by the `recordset` event. */
interface MssqlColumn {
  name: string
  scale?: number
  type?: { declaration?: string; name?: string }
}

/** The library keeps whatever a datetime2 or time holds below a millisecond in this side field, in milliseconds. */
type MssqlDate = Date & { nanosecondsDelta?: number }

/** With `arrayRowMode` on, each row is an array of values; the published types still describe objects. */
type MssqlArrayRows = unknown[][]

/** An error from the `error` event. `number` is SQL Server's own error number. */
type MssqlError = Error & { number?: number; lineNumber?: number; code?: string; procName?: string }

const MSSQL_KINDS: [RegExp, ColumnKind][] = [
  [/^(int|bigint|smallint|tinyint)$/, 'integer'],
  [/^(decimal|numeric|money|smallmoney)$/, 'decimal'],
  [/^(float|real)$/, 'float'],
  [/^bit$/, 'bool'],
  [/^(date|time|datetime|datetime2|smalldatetime|datetimeoffset)$/, 'date'],
  [/^(binary|varbinary|image|timestamp|rowversion)$/, 'binary'],
]

/** What a column of this SQL Server type holds. Undefined when the type is not known. */
export function mssqlKind(type: string): ColumnKind | undefined {
  const name = type.toLowerCase().replace(/\s*\(.*$/, '')
  if (!name) return undefined
  return MSSQL_KINDS.find(([pattern]) => pattern.test(name))?.[1] ?? 'text'
}

const EXACT = /^(decimal|numeric|money|smallmoney)$/i

// Money always has four decimal places; the server does not report that as the column's scale.
const exactScale = (type: string, scale: number | undefined) => (/money/i.test(type) ? 4 : Math.min(scale ?? 0, 38))

/** Writes out a number given in exponent form ("1.5e-7", "-2.5e+21") as plain digits. */
function plainDigits(text: string): string {
  const match = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/.exec(text)
  if (!match) return text
  const [, sign, first, rest = '', exponent] = match
  const digits = first + rest
  const point = Number(exponent) + 1
  if (point <= 0) return `${sign}0.${'0'.repeat(-point)}${digits}`
  if (point >= digits.length) return `${sign}${digits}${'0'.repeat(point - digits.length)}`
  return `${sign}${digits.slice(0, point)}.${digits.slice(point)}`
}

/** A `real` is read into a wider number, which adds digits it never had. This gives back the shortest number that is the same `real`. */
function float32(value: number): number {
  if (!Number.isFinite(value) || Math.fround(value) !== value) return value
  for (let digits = 1; digits <= 9; digits++) {
    const short = Number(value.toPrecision(digits))
    if (Math.fround(short) === value) return short
  }
  return value
}

/**
 * The driver reads decimals and money as floating-point numbers, which hold 15 digits reliably.
 * True when the value as stored (all digits, down to the column's scale) is longer than that, so
 * its last digits were lost on the way.
 */
export function roundedDecimal(value: unknown, type: string, scale: number | undefined): boolean {
  return typeof value === 'number' && EXACT.test(type) && Math.abs(value) * 10 ** exactScale(type, scale) >= 1e15
}

/** Turns a value from the driver into what the database would print for that column type. */
export function mssqlCell(value: unknown, type: string, scale: number | undefined): Cell {
  if (value === null || value === undefined) return null
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    const iso = value.toISOString()
    const date = iso.slice(0, 10)
    const extra = Math.round(((value as MssqlDate).nanosecondsDelta ?? 0) * 1e7)
    const time = `${iso.slice(11, 23)}${extra > 0 ? String(extra).padStart(4, '0') : ''}`.replace(/\.?0+$/, '')
    const t = /^date$/i.test(type) ? '' : time.length === 5 ? `${time}:00` : time
    if (/^date$/i.test(type)) return date
    if (/^time$/i.test(type)) return t.length === 2 ? `${t}:00:00` : t
    // The driver hands back the instant in UTC and drops the original offset.
    if (/^datetimeoffset$/i.test(type)) return `${date} ${t} +00:00`
    return `${date} ${t}`
  }
  if (typeof value === 'number' && /^real$/i.test(type)) return toCell(float32(value))
  if (typeof value === 'number' && Number.isFinite(value) && EXACT.test(type)) {
    if (roundedDecimal(value, type, scale)) {
      // Only the first 15 digits are what the database holds, so no more than that is shown.
      // Past 15 digits before the point there is nothing better than the nearest whole number.
      return Math.abs(value) >= 1e15 ? plainDigits(String(Math.round(value))) : plainDigits(value.toExponential(14))
    }
    const fixed = value.toFixed(exactScale(type, scale))
    // Money keeps at least two decimal places; decimals keep their declared scale.
    return /money/i.test(type) ? fixed.replace(/0{1,2}$/, '') : fixed
  }
  return toCell(value)
}

const roundedNotice = (column: string, type: string) =>
  `Column "${column}" holds numbers with more than 15 digits, which is more than can be read exactly, so they are shown rounded to 15. `
  + `Use ${/money/i.test(type) ? 'CONVERT(varchar(50), ..., 2)' : 'CAST(... AS varchar(50))'} to see them exactly.`

// Error 266 is raised when a batch ends with a different number of open transactions than it
// started with. Each batch here runs through sp_executesql, so a lone BEGIN TRANSACTION or COMMIT
// sets it off although nothing is wrong. Raised by a stored procedure, it names that procedure.
const isTransactionCountNoise = (err: MssqlError) => err.number === 266 && !err.procName

type OpenSet = ResultSet & { types: { name: string; scale?: number }[]; json: boolean }

export async function mssqlDriver(config: ConnectionConfig, password: string): Promise<Driver> {
  const mssql = (await import('mssql')).default
  type Pool = InstanceType<typeof mssql.ConnectionPool>
  const settings = {
    server: config.host ?? 'localhost',
    port: config.port || 1433,
    database: config.database || undefined,
    user: config.user,
    password,
    connectionTimeout: 15000,
    requestTimeout: 0,
    options: { encrypt: config.encrypt ?? true, trustServerCertificate: config.trustServerCertificate ?? false, useUTC: true },
    // One physical connection per slot: a run and its clean-up are then certain to share a session.
    pool: { max: 1, min: 0, idleTimeoutMillis: 120000 },
  }

  const MAX_SLOTS = 4
  const idle: Pool[] = []
  const waiting: ((slot: Pool) => void)[] = []
  let open = 0
  let closed = false

  async function acquire(): Promise<Pool> {
    const free = idle.pop()
    if (free) return free
    if (open < MAX_SLOTS) {
      open++
      try {
        const slot = await new mssql.ConnectionPool(settings).connect()
        slot.on('error', () => undefined)
        return slot
      } catch (err) {
        open--
        throw err
      }
    }
    return new Promise((resolve) => waiting.push(resolve))
  }

  function release(slot: Pool, broken = false): void {
    if (broken || closed) {
      open--
      void slot.close().catch(() => undefined)
      return
    }
    const next = waiting.shift()
    if (next) next(slot)
    else idle.push(slot)
  }

  release(await acquire())

  /** Runs one batch, adding to `result`. Resolves (never rejects) once the server is done with it. */
  function runBatch(slot: Pool, sql: string, firstLine: number, collector: RowCollector, result: DriverResult, signal?: AbortSignal): Promise<'ok' | 'error' | 'stopped'> {
    return new Promise((resolve) => {
      const request = slot.request()
      request.stream = true
      request.arrayRowMode = true
      const rounded = new Set<string>()
      let current: OpenSet | null = null
      let selected = false
      let outcome: 'ok' | 'error' | 'stopped' = 'ok'
      let settled = false
      const finish = () => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', onAbort)
        resolve(outcome)
      }
      const stop = () => {
        if (outcome !== 'ok') return
        outcome = 'stopped'
        request.cancel()
      }
      const onAbort = () => {
        if (outcome === 'ok') markCancelled(result)
        stop()
      }
      signal?.addEventListener('abort', onAbort)
      // A throw inside one of these handlers would take the whole server down, so each is fenced.
      const safely = <A extends unknown[]>(fn: (...args: A) => void) => (...args: A) => {
        try { fn(...args) } catch (err) {
          if (outcome === 'ok') { outcome = 'error'; result.error = { message: `Could not read the result: ${message(err)}` } }
          request.cancel()
        }
      }

      request.on('recordset', safely((columns: Record<string, MssqlColumn>) => {
        const list = Object.values(columns)
        const types = list.map((c) => ({ name: c.type?.declaration ?? c.type?.name ?? '', scale: c.scale }))
        // FOR JSON / FOR XML arrive as one value split over many rows; they are joined back up.
        const joined = list.length === 1 ? /^(JSON|XML)_F52E2B61-18A1-11d1-B105-00805F49916B$/i.exec(list[0].name)?.[1].toLowerCase() : undefined
        current = {
          columns: list.map((c, i) => {
            const kind = joined === 'json' ? 'json' : mssqlKind(types[i].name)
            return { name: c.name, type: types[i].name, numeric: isNumericKind(kind), ...(kind ? { kind } : {}) }
          }),
          rows: [], truncated: false, types,
          json: joined !== undefined,
        }
        result.resultSets.push(current)
        selected = true
      }))
      request.on('row', safely((raw: unknown) => {
        if (!current) return
        const set = current
        const row = Array.isArray(raw) ? raw : Object.values(raw as Record<string, unknown>)
        if (set.json) {
          const piece = row[0] === null || row[0] === undefined ? '' : String(row[0])
          if (set.rows.length === 0) set.rows.push([piece])
          else set.rows[0][0] = `${set.rows[0][0] ?? ''}${piece}`
          return
        }
        const pushed = collector.push(set, () => row.map((value, i) => {
          const { name, scale } = set.types[i] ?? { name: '' }
          const column = set.columns[i].name
          if (!rounded.has(column) && roundedDecimal(value, name, scale)) {
            rounded.add(column)
            result.messages.push(roundedNotice(column, name))
          }
          return mssqlCell(value, name, scale)
        }))
        if (pushed === 'stop') stop()
      }))
      request.on('info', safely((info: { message: string }) => { result.messages.push(info.message) }))
      request.on('rowsaffected', safely((count: number) => {
        if (selected) selected = false
        else result.rowsAffected = (result.rowsAffected ?? 0) + count
      }))
      request.on('error', (err: MssqlError) => {
        if (outcome === 'stopped' || err.code === 'ECANCEL') { setTimeout(finish, 200); return }
        if (isTransactionCountNoise(err)) return
        if (outcome === 'ok') {
          outcome = 'error'
          result.error = { message: err.message, line: err.lineNumber ? err.lineNumber + firstLine - 1 : undefined }
        }
        // 'done' normally follows; this covers a connection that died and will never say so.
        setTimeout(finish, 1500)
      })
      request.on('done', finish)
      request.query(sql)
    })
  }

  async function query(sql: string, maxRows: number, signal?: AbortSignal): Promise<DriverResult> {
    const result = emptyResult()
    const slot = await acquire()
    let broken = false
    try {
      // A read-only run happens inside a transaction that is always rolled back afterwards.
      if (config.readOnly) await slot.request().batch('BEGIN TRANSACTION')
      const collector = new RowCollector(result, maxRows)
      for (const batch of splitBatches(sql)) {
        // The listener inside a batch cannot see a stop that came before the batch began.
        if (signal?.aborted) { markCancelled(result); break }
        const outcome = await runBatch(slot, batch.sql, batch.line, collector, result, signal)
        if (outcome !== 'ok') break
      }
      for (const set of result.resultSets) delete (set as Partial<OpenSet>).types, delete (set as Partial<OpenSet>).json
      // Leave the session as it was found, so nothing carries over into the next run.
      const tidy = await slot.request().batch<{ was_open: number }>(
        `DECLARE @open int = @@TRANCOUNT; IF @open > 0 ROLLBACK TRANSACTION; SELECT @open AS was_open;${config.database ? ` USE [${config.database.replace(/]/g, ']]')}];` : ''}`)
      const wasOpen = Number(tidy.recordset?.[0]?.was_open ?? 0)
      if (wasOpen > 0 && !config.readOnly) {
        result.messages.push(ROLLED_BACK)
      }
    } catch (err) {
      broken = true
      result.error ??= { message: message(err) }
    } finally {
      release(slot, broken)
    }
    return result
  }

  async function rows(sql: string): Promise<Cell[][]> {
    const slot = await acquire()
    try {
      const request = slot.request()
      request.arrayRowMode = true
      const out = await request.query(sql)
      return (out.recordset as unknown as MssqlArrayRows).map((r) => r.map(toCell))
    } finally {
      release(slot)
    }
  }

  return {
    query,
    async schema() {
      const [columns, keys] = await Promise.all([
        rows(`
          SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME,
                 c.DATA_TYPE + CASE
                   WHEN c.CHARACTER_MAXIMUM_LENGTH = -1 THEN '(max)'
                   WHEN c.CHARACTER_MAXIMUM_LENGTH IS NOT NULL AND c.DATA_TYPE NOT IN ('text', 'ntext', 'image', 'xml') THEN '(' + CAST(c.CHARACTER_MAXIMUM_LENGTH AS varchar(10)) + ')'
                   WHEN c.DATA_TYPE IN ('decimal', 'numeric') THEN '(' + CAST(c.NUMERIC_PRECISION AS varchar(4)) + ',' + CAST(c.NUMERIC_SCALE AS varchar(4)) + ')'
                   WHEN c.DATA_TYPE IN ('datetime2', 'time', 'datetimeoffset') THEN '(' + CAST(c.DATETIME_PRECISION AS varchar(2)) + ')'
                   ELSE '' END,
                 c.IS_NULLABLE,
                 CASE WHEN k.COLUMN_NAME IS NULL THEN 0 ELSE 1 END
          FROM INFORMATION_SCHEMA.COLUMNS c
          JOIN INFORMATION_SCHEMA.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          LEFT JOIN INFORMATION_SCHEMA.TABLE_CONSTRAINTS tc
            ON tc.TABLE_SCHEMA = c.TABLE_SCHEMA AND tc.TABLE_NAME = c.TABLE_NAME AND tc.CONSTRAINT_TYPE = 'PRIMARY KEY'
          LEFT JOIN INFORMATION_SCHEMA.KEY_COLUMN_USAGE k
            ON k.CONSTRAINT_SCHEMA = tc.CONSTRAINT_SCHEMA AND k.CONSTRAINT_NAME = tc.CONSTRAINT_NAME AND k.COLUMN_NAME = c.COLUMN_NAME
          ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`),
        rows(`
          SELECT ps.name, pt.name, pc.name, rs.name, rt.name, rc.name
          FROM sys.foreign_key_columns k
          JOIN sys.tables pt ON pt.object_id = k.parent_object_id
          JOIN sys.schemas ps ON ps.schema_id = pt.schema_id
          JOIN sys.columns pc ON pc.object_id = k.parent_object_id AND pc.column_id = k.parent_column_id
          JOIN sys.tables rt ON rt.object_id = k.referenced_object_id
          JOIN sys.schemas rs ON rs.schema_id = rt.schema_id
          JOIN sys.columns rc ON rc.object_id = k.referenced_object_id AND rc.column_id = k.referenced_column_id`).catch(() => []),
      ])
      return buildSchema(columns, keys)
    },
    async close() {
      closed = true
      await Promise.all(idle.splice(0).map((slot) => slot.close().catch(() => undefined)))
    },
  }
}
