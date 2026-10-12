import { createRequire } from 'node:module'
import type { Cell, ColumnKind, ForeignKey, ResultSet, SchemaTable } from '../../shared/types.ts'
import type { DriverResult } from './types.ts'

export const require = createRequire(import.meta.url)

export const MAX_BINARY_BYTES = 2048

export const STOPPED = 'The server kept sending rows long past the row limit, so the query was stopped. Add a WHERE, TOP or LIMIT to see a specific part.'

export const CANCELLED = 'Stopped by you.'

export const ROLLED_BACK = 'A transaction was still open when the run ended, so it was rolled back. Put BEGIN and COMMIT in the same run to keep the changes.'

/** How many rows past the limit are read and thrown away before the query is stopped outright. */
export const overflowAllowance = (maxRows: number) => Math.max(100000, maxRows * 4)

export const emptyResult = (): DriverResult => ({ resultSets: [], rowsAffected: null, messages: [] })

/** Records that the run's AbortSignal ended it. The message is added once however often this is called. */
export function markCancelled(result: DriverResult): void {
  if (result.stopped) return
  result.stopped = true
  result.messages.push(CANCELLED)
}

/** What became of a row: `stop` means the caller must now end the query. */
export type Pushed = 'kept' | 'dropped' | 'stop'

/**
 * Applies the row limit for one run. Rows up to the limit are kept in each result set; later ones
 * are counted and thrown away, and once too many have been thrown away the query has to be stopped.
 */
export class RowCollector {
  private discarded = 0
  private readonly result: DriverResult
  private readonly maxRows: number

  constructor(result: DriverResult, maxRows: number) {
    this.result = result
    this.maxRows = maxRows
  }

  /** `convert` only runs for a row that is kept, so the ones thrown away cost nothing. */
  push(set: ResultSet, convert: () => Cell[]): Pushed {
    if (set.rows.length < this.maxRows) {
      set.rows.push(convert())
      return 'kept'
    }
    set.truncated = true
    // Says `stop` once only: rows already on their way still arrive after the query is cancelled.
    if (++this.discarded !== overflowAllowance(this.maxRows) + 1) return 'dropped'
    this.result.messages.push(STOPPED)
    return 'stop'
  }
}

export function toCell(value: unknown): Cell {
  if (value === null || value === undefined) return null
  if (typeof value === 'string' || typeof value === 'boolean') return value
  if (typeof value === 'number') return Number.isFinite(value) ? value : String(value)
  // Beyond 2^53 a JavaScript number silently changes the value, so those stay as text.
  if (typeof value === 'bigint') return value >= -9007199254740991n && value <= 9007199254740991n ? Number(value) : value.toString()
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString()
  if (value instanceof Uint8Array) {
    const hex = Buffer.from(value.subarray(0, MAX_BINARY_BYTES)).toString('hex')
    return `0x${hex}${value.length > MAX_BINARY_BYTES ? `… (${value.length} bytes, first ${MAX_BINARY_BYTES} shown)` : ''}`
  }
  return JSON.stringify(value)
}

const DATE_TEXT = /^\d{4}-\d{2}-\d{2}([ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$/

/**
 * Works out what a column holds from its values, for a database that reports no column types.
 * Feed it the values as the database handed them over, before `toCell`.
 */
export class ValueKinds {
  private readonly seen = new Set<ColumnKind>()

  add(value: unknown): void {
    if (value === null || value === undefined) return
    if (typeof value === 'bigint') this.seen.add('integer')
    else if (typeof value === 'number') this.seen.add(Number.isInteger(value) ? 'integer' : 'float')
    else if (typeof value === 'boolean') this.seen.add('bool')
    else if (value instanceof Uint8Array) this.seen.add('binary')
    else this.seen.add(typeof value === 'string' && DATE_TEXT.test(value) ? 'date' : 'text')
  }

  /** Undefined when there was nothing to go on: no rows, or only NULLs. */
  kind(): ColumnKind | undefined {
    if (this.seen.size === 0) return undefined
    if (this.seen.size === 1) return [...this.seen][0]
    if (this.seen.size === 2 && this.seen.has('integer') && this.seen.has('float')) return 'float'
    return 'text'
  }
}

export const isNumericKind = (kind: ColumnKind | undefined) => kind === 'integer' || kind === 'decimal' || kind === 'float'

export const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

export const lineAt = (sql: string, offset: number) => sql.slice(0, Math.max(0, offset)).split('\n').length

/** Groups flat (schema, table, kind, column...) rows into tables and attaches foreign keys. */
export function buildSchema(rows: Cell[][], fkRows: Cell[][] = []): SchemaTable[] {
  const tables = new Map<string, SchemaTable>()
  for (const [schema, name, kind, column, type, nullable, pk] of rows) {
    const key = `${schema ?? ''}\u0000${name}`
    let table = tables.get(key)
    if (!table) {
      table = { schema: String(schema ?? ''), name: String(name), kind: /view/i.test(String(kind)) ? 'view' : 'table', columns: [], foreignKeys: [] }
      tables.set(key, table)
    }
    table.columns.push({
      name: String(column),
      type: String(type ?? ''),
      nullable: nullable === true || nullable === 1 || /^(yes|1|true|t)$/i.test(String(nullable)),
      pk: pk === true || pk === 1 || /^(1|true|t)$/i.test(String(pk)),
    })
  }
  for (const [schema, name, column, refSchema, refTable, refColumn] of fkRows) {
    const fk: ForeignKey = { column: String(column), refSchema: String(refSchema ?? ''), refTable: String(refTable), refColumn: String(refColumn) }
    tables.get(`${schema ?? ''}\u0000${name}`)?.foreignKeys?.push(fk)
  }
  return [...tables.values()]
}
