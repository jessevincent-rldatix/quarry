import type { Readable } from 'node:stream'
import type { Cell, ColumnKind, ConnectionConfig, ResultColumn, ResultSet } from '../../shared/types.ts'
import { splitStatements } from '../../shared/sqlScan.ts'
import { buildSchema, emptyResult, isNumericKind, markCancelled, message, RowCollector, toCell } from './common.ts'
import type { Driver, DriverResult } from './types.ts'

// ── Snowflake ────────────────────────────────────────────────────────────────
// One session for the connection, so USE, session variables and temporary tables carry from one
// run to the next. Snowflake takes one statement per request; a script is sent a statement at a time.

const KINDS: Record<string, ColumnKind> = {
  real: 'float', float: 'float', text: 'text', boolean: 'bool', date: 'date', time: 'date', timestamp_ltz: 'date', timestamp_ntz: 'date',
  timestamp_tz: 'date', variant: 'json', object: 'json', array: 'json', binary: 'binary',
}

/** The parts of the driver's column description this file reads. */
export interface SnowflakeColumn {
  getName(): string
  /** The driver's name for the type: fixed (any exact number), real, text, timestamp_ntz and so on. */
  getType(): string
  getScale(): number
  getPrecision(): number
}

/** Describes a result column. A "fixed" number is an integer when it has no decimal places. */
export function snowflakeColumn(column: SnowflakeColumn): ResultColumn {
  const type = (column.getType() ?? '').toLowerCase()
  const scale = Number(column.getScale() ?? 0)
  const kind = type === 'fixed' ? (scale > 0 ? 'decimal' : 'integer') : KINDS[type]
  const label = type === 'fixed' ? `number(${column.getPrecision() ?? 38},${scale})` : type
  return { name: column.getName(), type: label, ...(isNumericKind(kind) ? { numeric: true } : {}), ...(kind ? { kind } : {}) }
}

/**
 * Numbers and dates are asked for as text, so a 38-digit number or a timestamp with nanoseconds
 * arrives exactly as the database holds it. Numbers that a JavaScript number holds exactly are
 * turned back into numbers; the rest stay as written.
 */
export function snowflakeCell(value: unknown, kind: ColumnKind | undefined): Cell {
  if (typeof value === 'string') {
    if (kind === 'integer') return Number.isSafeInteger(Number(value)) ? Number(value) : value
    if (kind === 'float') return Number.isFinite(Number(value)) ? Number(value) : value
  }
  return toCell(value)
}

/** The parts of a running statement this file uses. */
interface SnowflakeStatement {
  getColumns(): SnowflakeColumn[] | undefined
  getNumUpdatedRows(): number | undefined
  streamRows(): Readable
  cancel(callback?: (err: Error | undefined) => void): void
}

interface SnowflakeConnection {
  connect(callback: (err: Error | undefined) => void): void
  connectAsync(callback: (err: Error | undefined) => void): Promise<unknown>
  execute(options: {
    sqlText: string
    streamResult: boolean
    rowMode: 'array'
    fetchAsString: string[]
    complete: (err: Error | undefined, statement: SnowflakeStatement) => void
  }): SnowflakeStatement
  destroy(callback: (err: Error | undefined) => void): void
}

interface SnowflakeSdk {
  configure(options: { logLevel: string }): void
  createConnection(options: Record<string, unknown>): SnowflakeConnection
}

/** The account identifier, whatever was pasted: "xy12345.eu-west-1", "myorg-myaccount" or the whole web address. */
export const accountName = (host: string) => host.trim().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').replace(/\.snowflakecomputing\.com$/i, '')

/** What the driver is given to sign in with, for each way of signing in. */
export function snowflakeLogin(config: ConnectionConfig, secret: string): Record<string, unknown> {
  const account = accountName(config.host ?? '')
  if (!account) throw new Error('Give the account identifier, such as myorg-myaccount (the part of the web address before .snowflakecomputing.com).')
  if (!config.user) throw new Error('Give the user name.')
  const common = {
    account,
    username: config.user,
    application: 'Quarry',
    // A session left idle is otherwise closed after four hours, and the next run would fail.
    clientSessionKeepAlive: true,
    ...(config.warehouse ? { warehouse: config.warehouse } : {}),
    ...(config.database ? { database: config.database } : {}),
    ...(config.schema ? { schema: config.schema } : {}),
    ...(config.role ? { role: config.role } : {}),
  }
  if (config.auth === 'sso') return { ...common, authenticator: 'EXTERNALBROWSER', clientStoreTemporaryCredential: true }
  if (config.auth === 'keypair') {
    if (!config.keyFile) throw new Error('Give the path to the private key file.')
    return { ...common, authenticator: 'SNOWFLAKE_JWT', privateKeyPath: config.keyFile, ...(secret ? { privateKeyPass: secret } : {}) }
  }
  if (!secret) throw new Error('Give the password or access token.')
  return { ...common, password: secret }
}

export async function snowflakeDriver(config: ConnectionConfig, secret: string, load: () => Promise<SnowflakeSdk> = loadSdk): Promise<Driver> {
  const login = snowflakeLogin(config, secret)
  const sdk = await load()
  // The driver logs to a file in the working folder unless told not to.
  sdk.configure({ logLevel: 'OFF' })
  let connection: SnowflakeConnection
  try {
    connection = sdk.createConnection(login)
  } catch (err) {
    // The key file is read here; the library's own message names neither the field nor the cause.
    throw new Error(config.auth === 'keypair' ? `The private key file could not be used: ${message(err)}` : message(err))
  }
  await new Promise<void>((resolve, reject) => {
    const done = (err: Error | undefined) => (err ? reject(new Error(message(err))) : resolve())
    // Single sign-on opens the browser and waits for it, which only the promise form of connect does.
    if (config.auth === 'sso') connection.connectAsync(done).catch(reject)
    else connection.connect(done)
  })

  interface Outcome { columns: ResultColumn[]; rows: Cell[][]; affected?: number; truncated: boolean; overLimit: boolean }

  /** Runs one statement. Rows go through `keep`, which says when enough have been read. */
  function execute(sql: string, keep: (row: Cell[], outcome: Outcome) => boolean, signal?: AbortSignal): Promise<Outcome> {
    return new Promise<Outcome>((resolve, reject) => {
      const outcome: Outcome = { columns: [], rows: [], truncated: false, overLimit: false }
      let settled = false
      let stream: Readable | undefined
      const finish = (err?: unknown) => {
        if (settled) return
        settled = true
        signal?.removeEventListener('abort', stop)
        if (err && !signal?.aborted && !outcome.overLimit) reject(err)
        else resolve(outcome)
      }
      const stop = () => {
        // Ends the statement on the warehouse, not just the reading of it.
        statement.cancel(() => undefined)
        stream?.destroy()
        finish()
      }
      const statement = connection.execute({
        sqlText: sql,
        streamResult: true,
        // Rows as arrays, so two columns with the same name both survive.
        rowMode: 'array',
        fetchAsString: ['Number', 'Date'],
        complete(err, done) {
          if (err) return finish(err)
          if (settled) return
          try {
            const affected = done.getNumUpdatedRows()
            // A statement that changes rows reports how many; the one-row table saying the same is not shown as well.
            if (typeof affected === 'number' && affected >= 0) { outcome.affected = affected; return finish() }
            outcome.columns = (done.getColumns() ?? []).map(snowflakeColumn)
            const kinds = outcome.columns.map((c) => c.kind)
            stream = done.streamRows()
            stream.on('data', (row: unknown[]) => {
              if (settled) return
              try {
                if (!keep(row.map((value, i) => snowflakeCell(value, kinds[i])), outcome)) { outcome.overLimit = true; stop() }
              } catch (fault) { finish(fault) }
            })
            stream.on('error', finish)
            stream.on('end', () => finish())
          } catch (fault) { finish(fault) }
        },
      })
      if (signal?.aborted) stop()
      else signal?.addEventListener('abort', stop)
    })
  }

  const run = async (sql: string, maxRows: number, signal?: AbortSignal): Promise<DriverResult> => {
    const result = emptyResult()
    for (const statement of splitStatements(sql, 'snowflake')) {
      if (signal?.aborted) { markCancelled(result); break }
      const set: ResultSet = { columns: [], rows: [], truncated: false }
      const collector = new RowCollector(result, maxRows)
      try {
        const outcome = await execute(statement.sql, (row) => collector.push(set, () => row) !== 'stop', signal)
        if (signal?.aborted) { markCancelled(result); break }
        if (outcome.affected !== undefined) {
          result.rowsAffected = (result.rowsAffected ?? 0) + outcome.affected
        } else if (outcome.columns.length > 0) {
          set.columns = outcome.columns
          result.resultSets.push(set)
        }
        if (outcome.overLimit) break
      } catch (err) {
        if (signal?.aborted) { markCancelled(result); break }
        const text = message(err)
        // "syntax error line 3 at position 4" counts lines within the one statement that was sent.
        const at = /\bline (\d+) at position \d+/.exec(text)
        result.error = { message: text, ...(at ? { line: Number(at[1]) + statement.line - 1 } : {}) }
        break
      }
    }
    return result
  }

  /** A catalog query in full, with its column names in lower case, for reading by name. */
  async function all(sql: string): Promise<{ names: string[]; rows: Cell[][] }> {
    const rows: Cell[][] = []
    const outcome = await execute(sql, (row) => { rows.push(row); return true })
    return { names: outcome.columns.map((c) => c.name.toLowerCase()), rows }
  }

  return {
    query: run,
    async schema() {
      const columns = await all(`
        SELECT c.table_schema, c.table_name, t.table_type, c.column_name,
               CASE WHEN c.data_type = 'NUMBER' THEN 'NUMBER(' || c.numeric_precision || ',' || c.numeric_scale || ')'
                    WHEN c.data_type = 'TEXT' AND c.character_maximum_length < 16777216 THEN 'VARCHAR(' || c.character_maximum_length || ')'
                    ELSE c.data_type END,
               c.is_nullable
        FROM information_schema.columns c
        JOIN information_schema.tables t ON t.table_schema = c.table_schema AND t.table_name = c.table_name
        WHERE c.table_schema <> 'INFORMATION_SCHEMA'
        ORDER BY c.table_schema, c.table_name, c.ordinal_position`).catch((err) => {
        // The list of tables is read from a database, so one has to be chosen.
        throw new Error(/current database/i.test(message(err)) ? 'Fill in "Database" on this connection to see its tables.' : message(err))
      })
      // Keys are optional in Snowflake and need no special right to list, but a failure here must not hide the tables.
      const pick = (found: { names: string[]; rows: Cell[][] }, ...wanted: string[]) => {
        const at = wanted.map((name) => found.names.indexOf(name))
        return at.some((i) => i < 0) ? [] : found.rows.map((row) => at.map((i) => row[i]))
      }
      const none = { names: [], rows: [] }
      const scope = config.database ? ' IN DATABASE' : ''
      const [primaryKeys, importedKeys] = await Promise.all([
        all(`SHOW PRIMARY KEYS${scope}`).catch(() => none),
        all(`SHOW IMPORTED KEYS${scope}`).catch(() => none),
      ])
      const primary = new Set(pick(primaryKeys, 'schema_name', 'table_name', 'column_name').map((k) => k.join('\u0000')))
      const foreign = pick(importedKeys, 'fk_schema_name', 'fk_table_name', 'fk_column_name', 'pk_schema_name', 'pk_table_name', 'pk_column_name')
      return buildSchema(columns.rows.map((c) => [...c, primary.has(`${c[0]}\u0000${c[1]}\u0000${c[3]}`)]), foreign)
    },
    close: () => new Promise<void>((resolve) => connection.destroy(() => resolve())),
  }
}

async function loadSdk(): Promise<SnowflakeSdk> {
  const module = await import('snowflake-sdk') as unknown as { default?: SnowflakeSdk } & SnowflakeSdk
  return module.default ?? module
}
