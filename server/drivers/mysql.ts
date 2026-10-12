import type { Cell, ColumnKind, ConnectionConfig, ResultColumn, ResultSet } from '../../shared/types.ts'
import { buildSchema, emptyResult, isNumericKind, markCancelled, message, ROLLED_BACK, RowCollector, toCell } from './common.ts'
import type { Driver, DriverResult } from './types.ts'

// ── MySQL / MariaDB ──────────────────────────────────────────────────────────
const MYSQL_TYPES: Record<number, string> = {
  0: 'decimal', 1: 'tinyint', 2: 'smallint', 3: 'int', 4: 'float', 5: 'double', 7: 'timestamp', 8: 'bigint', 9: 'mediumint', 10: 'date',
  11: 'time', 12: 'datetime', 13: 'year', 14: 'date', 15: 'varchar', 16: 'bit', 17: 'timestamp', 18: 'datetime', 19: 'time',
  245: 'json', 246: 'decimal', 247: 'enum', 248: 'set', 249: 'tinytext', 250: 'mediumtext', 251: 'longtext', 252: 'text', 253: 'varchar', 254: 'char',
}

// The server uses one type code for a text type and its binary twin; the binary character set tells them apart.
const MYSQL_BINARY_TYPES: Record<number, string> = { 15: 'varbinary', 249: 'tinyblob', 250: 'mediumblob', 251: 'longblob', 252: 'blob', 253: 'varbinary', 254: 'binary' }

const MYSQL_KINDS: Record<number, ColumnKind> = {
  0: 'decimal', 1: 'integer', 2: 'integer', 3: 'integer', 4: 'float', 5: 'float', 7: 'date', 8: 'integer', 9: 'integer', 10: 'date',
  11: 'date', 12: 'date', 13: 'integer', 14: 'date', 16: 'integer', 17: 'date', 18: 'date', 19: 'date', 245: 'json', 246: 'decimal',
}

const BINARY_CHARSET = 63
const BIT = 16
const ENUM_FLAG = 256
const SET_FLAG = 2048

/** A column as the server describes it ahead of the rows (mysql2's `fields` event). */
export interface MysqlField {
  name: string
  /** The wire type code. Older versions of the library call it `type`. */
  columnType?: number
  type?: number
  /** The character set number: 63 marks bytes rather than text. */
  characterSet?: number
  flags?: number
}

/** Describes a result column. The type is blank, and the kind absent, for a type code that is not known. */
export function mysqlColumn(field: MysqlField): ResultColumn {
  const code = field.columnType ?? field.type ?? -1
  const flags = Number(field.flags ?? 0)
  const binary = field.characterSet === BINARY_CHARSET && code in MYSQL_BINARY_TYPES
  // Enum and set columns are sent as plain strings with a flag.
  const type = binary ? MYSQL_BINARY_TYPES[code] : code === 254 && flags & ENUM_FLAG ? 'enum' : code === 254 && flags & SET_FLAG ? 'set' : MYSQL_TYPES[code] ?? ''
  const kind = binary ? 'binary' : MYSQL_KINDS[code] ?? (type ? 'text' : undefined)
  return { name: field.name, type, ...(isNumericKind(kind) ? { numeric: true } : {}), ...(kind ? { kind } : {}) }
}

/** A bit column arrives as bytes. Shown as the number those bits spell: 0 or 1 for bit(1). */
export function mysqlBit(value: unknown): Cell {
  if (!(value instanceof Uint8Array)) return toCell(value)
  let bits = 0n
  for (const byte of value) bits = (bits << 8n) | BigInt(byte)
  return toCell(bits)
}

/**
 * What this file relies on from mysql2 beyond its published types: the query object of the plain
 * (non-promise) connection, which hands over columns and rows one at a time as events.
 */
interface MysqlRowStream {
  /** Once per statement that returns rows; with no fields for a statement that returns none. */
  on(event: 'fields', listener: (fields: MysqlField[] | undefined) => void): this
  /** A row as an array, or the summary of a statement that returned no rows. */
  on(event: 'result', listener: (row: unknown[] | MysqlSummary | null) => void): this
  on(event: 'error', listener: (err: Error) => void): this
  on(event: 'end', listener: () => void): this
}

/** Bit 1 of `serverStatus` is set while a transaction is open. */
interface MysqlSummary { affectedRows?: number; serverStatus?: number }

/** The plain connection underneath a promise connection. */
interface MysqlCoreConnection { connection: { query(options: { sql: string; rowsAsArray: boolean }): MysqlRowStream } }

export async function mysqlDriver(config: ConnectionConfig, password: string): Promise<Driver> {
  const mysql = await import('mysql2/promise')
  const login = {
    host: config.host ?? 'localhost',
    port: config.port || 3306,
    database: config.database || undefined,
    user: config.user,
    password,
    ssl: config.encrypt ? { rejectUnauthorized: !config.trustServerCertificate } : undefined,
    connectTimeout: 15000,
  }
  const pool = mysql.createPool({
    ...login,
    connectionLimit: 4,
    multipleStatements: true,
    dateStrings: true,
    supportBigNumbers: true,
    bigNumberStrings: true,
  })
  await (await pool.getConnection()).release()

  /** Stops the statement a connection is running. Uses a connection of its own, so it works when every pooled one is busy. */
  async function kill(threadId: number): Promise<void> {
    const killer = await mysql.createConnection(login)
    try {
      await killer.query(`KILL QUERY ${Number(threadId)}`)
    } finally {
      killer.destroy()
    }
  }

  const run = async (sql: string, maxRows: number, signal?: AbortSignal): Promise<DriverResult> => {
    const result = emptyResult()
    if (signal?.aborted) { markCancelled(result); return result }
    const connection = await pool.getConnection()
    let killing: Promise<void> | undefined
    let overLimit = false
    let finished = false
    let inTransaction = false
    const stop = () => {
      if (finished) return
      killing ??= kill(connection.threadId).catch(() => undefined)
    }
    const onAbort = () => {
      if (!finished) markCancelled(result)
      stop()
    }
    signal?.addEventListener('abort', onAbort)
    try {
      // Applies to every transaction in this session, so a COMMIT inside the batch cannot lift it.
      if (config.readOnly) await connection.query('SET SESSION TRANSACTION READ ONLY')
      // Waiting for a connection can take a while, and the stop may have come in the meantime.
      if (signal?.aborted) markCancelled(result)
      else await new Promise<void>((resolve, reject) => {
        // The event form hands over one row at a time, so a huge result is never held in memory.
        const query = (connection as unknown as MysqlCoreConnection).connection.query({ sql, rowsAsArray: true })
        const collector = new RowCollector(result, maxRows)
        let set: ResultSet | undefined
        let bits: boolean[] = []
        // A fault inside a handler must end the run with an error, not leave it waiting for ever.
        const safely = <A extends unknown[]>(handler: (...args: A) => void) => (...args: A) => { try { handler(...args) } catch (err) { reject(err) } }
        query.on('fields', safely((fields) => {
          // Statements that return no rows announce themselves with no fields.
          if (!Array.isArray(fields)) { set = undefined; return }
          set = { columns: fields.map(mysqlColumn), rows: [], truncated: false }
          bits = fields.map((f) => (f.columnType ?? f.type) === BIT)
          result.resultSets.push(set)
        }))
        query.on('result', safely((row) => {
          if (!Array.isArray(row)) {
            // Not a row: the summary of a statement that returned none.
            const affected = row?.affectedRows
            inTransaction = ((row?.serverStatus ?? 0) & 1) === 1
            if (typeof affected === 'number') result.rowsAffected = (result.rowsAffected ?? 0) + affected
            set = undefined
            return
          }
          if (!set) return
          if (collector.push(set, () => row.map((value, i) => (bits[i] ? mysqlBit(value) : toCell(value)))) === 'stop') {
            overLimit = true
            stop()
          }
        }))
        query.on('error', reject)
        query.on('end', resolve)
      })
    } catch (err) {
      // Being stopped comes back from the server as an error; that one is expected.
      if (!result.stopped && !overLimit) {
        const line = /at line (\d+)/.exec(message(err))
        result.error = { message: message(err), ...(line ? { line: Number(line[1]) } : {}) }
      }
    } finally {
      finished = true
      signal?.removeEventListener('abort', onAbort)
      // A kill that lands late must not hit the clean-up below, or the next run on this connection.
      await killing
      await connection.query('ROLLBACK').catch(() => undefined)
      if (inTransaction && !config.readOnly && !result.error) result.messages.push(ROLLED_BACK)
      // Resetting the session drops temporary tables, variables and a changed default database.
      await connection.changeUser({}).catch(() => undefined)
      connection.release()
    }
    // SET and USE report zero rows; beside a result that is noise, not news.
    if (result.rowsAffected === 0 && result.resultSets.length > 0) result.rowsAffected = null
    return result
  }

  const rows = async (sql: string) => ((await pool.query({ sql, rowsAsArray: true }))[0] as unknown[][]).map((r) => r.map(toCell))

  return {
    query: run,
    async schema() {
      const [columns, keys] = await Promise.all([
        rows(`
          SELECT c.TABLE_SCHEMA, c.TABLE_NAME, t.TABLE_TYPE, c.COLUMN_NAME, c.COLUMN_TYPE, c.IS_NULLABLE,
                 CASE WHEN c.COLUMN_KEY = 'PRI' THEN 1 ELSE 0 END
          FROM information_schema.COLUMNS c
          JOIN information_schema.TABLES t ON t.TABLE_SCHEMA = c.TABLE_SCHEMA AND t.TABLE_NAME = c.TABLE_NAME
          WHERE c.TABLE_SCHEMA NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')
          ORDER BY c.TABLE_SCHEMA, c.TABLE_NAME, c.ORDINAL_POSITION`),
        rows(`
          SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, REFERENCED_TABLE_SCHEMA, REFERENCED_TABLE_NAME, REFERENCED_COLUMN_NAME
          FROM information_schema.KEY_COLUMN_USAGE
          WHERE REFERENCED_TABLE_NAME IS NOT NULL`).catch(() => []),
      ])
      return buildSchema(columns, keys)
    },
    async close() { await pool.end() },
  }
}
