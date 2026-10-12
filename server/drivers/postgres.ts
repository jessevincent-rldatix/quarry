import type { ColumnKind, ConnectionConfig, ResultColumn, ResultSet } from '../../shared/types.ts'
import { buildSchema, emptyResult, isNumericKind, lineAt, markCancelled, message, ROLLED_BACK, RowCollector, toCell } from './common.ts'
import type { Driver, DriverResult } from './types.ts'

// ── PostgreSQL ───────────────────────────────────────────────────────────────
export const PG_TYPES: Record<number, string> = {
  16: 'bool', 17: 'bytea', 18: 'char', 19: 'name', 20: 'int8', 21: 'int2', 23: 'int4', 24: 'regproc', 25: 'text', 26: 'oid', 27: 'tid', 28: 'xid', 29: 'cid',
  114: 'json', 142: 'xml', 199: 'json[]', 600: 'point', 601: 'lseg', 602: 'path', 603: 'box', 604: 'polygon', 628: 'line', 650: 'cidr', 651: 'cidr[]',
  700: 'float4', 701: 'float8', 705: 'unknown', 718: 'circle', 774: 'macaddr8', 790: 'money', 791: 'money[]', 829: 'macaddr', 869: 'inet',
  1000: 'bool[]', 1001: 'bytea[]', 1002: 'char[]', 1003: 'name[]', 1005: 'int2[]', 1007: 'int4[]', 1009: 'text[]', 1014: 'char[]', 1015: 'varchar[]', 1016: 'int8[]',
  1021: 'float4[]', 1022: 'float8[]', 1028: 'oid[]', 1040: 'macaddr[]', 1041: 'inet[]', 1042: 'char', 1043: 'varchar', 1082: 'date', 1083: 'time',
  1114: 'timestamp', 1115: 'timestamp[]', 1182: 'date[]', 1183: 'time[]', 1184: 'timestamptz', 1185: 'timestamptz[]', 1186: 'interval', 1187: 'interval[]',
  1231: 'numeric[]', 1266: 'timetz', 1270: 'timetz[]', 1560: 'bit', 1561: 'bit[]', 1562: 'varbit', 1563: 'varbit[]', 1700: 'numeric',
  2205: 'regclass', 2206: 'regtype', 2249: 'record', 2278: 'void', 2950: 'uuid', 2951: 'uuid[]', 3220: 'pg_lsn', 3614: 'tsvector', 3615: 'tsquery',
  3802: 'jsonb', 3807: 'jsonb[]', 3904: 'int4range', 3905: 'int4range[]', 3906: 'numrange', 3907: 'numrange[]', 3908: 'tsrange', 3909: 'tsrange[]',
  3910: 'tstzrange', 3911: 'tstzrange[]', 3912: 'daterange', 3913: 'daterange[]', 3926: 'int8range', 3927: 'int8range[]',
  4451: 'int4multirange', 4532: 'nummultirange', 4533: 'tsmultirange', 4534: 'tstzmultirange', 4535: 'datemultirange', 4536: 'int8multirange',
}

const PG_KINDS: Record<number, ColumnKind> = {
  16: 'bool', 17: 'binary', 20: 'integer', 21: 'integer', 23: 'integer', 26: 'integer', 114: 'json', 700: 'float', 701: 'float',
  1082: 'date', 1083: 'date', 1114: 'date', 1184: 'date', 1266: 'date', 1700: 'decimal', 3802: 'json',
}

/** A type's name and kind as read from the server's catalogue, for types not in the table above. */
export interface PgType { name: string; kind: ColumnKind }

// pg_type.typcategory, for a type looked up by name. Everything else is shown as the text it arrives as.
const PG_CATEGORY_KINDS: Record<string, ColumnKind> = { B: 'bool', N: 'decimal', D: 'date' }

export const pgTypeFromCatalogue = (name: string, category: string): PgType => ({ name, kind: PG_CATEGORY_KINDS[category] ?? 'text' })

/** Describes a result column. The type is blank, and the kind absent, when the type is in neither the table nor `looked`. */
export function pgColumn(name: string, oid: number, looked?: ReadonlyMap<number, PgType>): ResultColumn {
  const type = PG_TYPES[oid] ?? looked?.get(oid)?.name ?? ''
  const kind = PG_KINDS[oid] ?? (PG_TYPES[oid] ? 'text' : looked?.get(oid)?.kind)
  return { name, type, numeric: isNumericKind(kind), ...(kind ? { kind } : {}) }
}

// What this file relies on from the pg library beyond its published types.

/** The wire connection under a client. Its `readyForQuery` message says whether a transaction is open (T), failed (E) or absent (I). */
interface PgWire {
  on(event: 'readyForQuery', listener: (m: { status: string }) => void): void
  on(event: 'connect' | 'end' | 'error', listener: () => void): void
  removeListener(event: 'readyForQuery', listener: (m: { status: string }) => void): void
  /** Takes a port and host, or the path of a Unix socket alone. */
  connect(port: number | string, host?: string): void
  /** Sends a cancel request for another connection's running query. Only valid as the first thing sent. */
  cancel(processID: number, secretKey: number): void
  stream: { destroy(): void }
}

/** A client's wire connection, and the two numbers the server gave it at login for cancelling its queries. */
interface PgClientInternals { connection: PgWire; processID: number; secretKey: number }

/** The part of a query's result that describes its columns. */
interface PgFields { fields: { name: string; dataTypeID: number }[] }

type PgFinal = Partial<PgFields> & { command?: string; rowCount?: number | null }

export async function postgresDriver(config: ConnectionConfig, password: string): Promise<Driver> {
  const pg = (await import('pg')).default
  // Values are shown as the text the server sent: exact decimals, dates without a timezone shift,
  // arrays and intervals in Postgres's own notation. Only small numbers and booleans are converted.
  const types = {
    getTypeParser: (oid: number, format?: string) => {
      if (format === 'binary') return pg.types.getTypeParser(oid, 'binary')
      if (oid === 16) return (v: string) => v === 't'
      if (oid === 21 || oid === 23 || oid === 26) return (v: string) => Number(v)
      if (oid === 700 || oid === 701) return (v: string) => (Number.isFinite(Number(v)) ? Number(v) : v)
      return (v: string) => v
    },
  }
  const host = config.host ?? 'localhost'
  const port = config.port || 5432
  const pool = new pg.Pool({
    host,
    port,
    database: config.database || undefined,
    user: config.user,
    password,
    ssl: config.encrypt ? { rejectUnauthorized: !config.trustServerCertificate } : undefined,
    max: 5,
    connectionTimeoutMillis: 15000,
    // Read-only is set as the session default, so it survives COMMIT and DISCARD ALL.
    options: config.readOnly ? '-c default_transaction_read_only=on' : undefined,
    types: types as never,
  })
  // An idle connection the server drops (restart, failover, firewall) must not take the process down.
  pool.on('error', () => undefined)
  // The same goes for one that fails while a run has it checked out.
  pool.on('connect', (client) => { client.on('error', () => undefined) })
  await (await pool.connect()).release()

  // Types the server had to be asked about: extensions, enums and anything else defined in this database.
  const looked = new Map<number, PgType>()

  /**
   * Asks the server to stop what `target` is running. This opens a connection of its own, as psql
   * does, so it works when every pooled connection is busy. A cancel request is the whole of that
   * connection: no login, and the server reads it before any encryption is set up.
   * Resolves once the server has dealt with it, or after a few seconds if it never answers.
   */
  function cancel(target: PgClientInternals): Promise<void> {
    return new Promise((resolve) => {
      const wire = new pg.Connection({} as never) as unknown as PgWire
      const timer = setTimeout(() => { wire.stream.destroy(); resolve() }, 5000)
      const done = () => { clearTimeout(timer); resolve() }
      wire.on('error', done)
      wire.on('end', done)
      wire.on('connect', () => wire.cancel(target.processID, target.secretKey))
      if (host.startsWith('/')) wire.connect(`${host}/.s.PGSQL.${port}`)
      else wire.connect(port, host)
    })
  }

  async function query(sql: string, maxRows: number, signal?: AbortSignal): Promise<DriverResult> {
    const result = emptyResult()
    if (signal?.aborted) { markCancelled(result); return result }
    const client = await pool.connect()
    const internals = client as unknown as PgClientInternals
    // Columns whose type name still has to be asked for.
    const unnamed: { set: ResultSet; index: number; name: string; oid: number }[] = []
    const nameTypes = async () => {
      const oids = [...new Set(unnamed.map((u) => u.oid).filter((oid) => !looked.has(oid)))]
      if (oids.length > 0) {
        const found = await client.query({
          text: `SELECT t.oid, CASE WHEN t.typcategory = 'A' AND e.typname IS NOT NULL THEN e.typname || '[]' ELSE t.typname END, t.typcategory
                 FROM pg_type t LEFT JOIN pg_type e ON e.oid = t.typelem WHERE t.oid = ANY($1::oid[])`,
          values: [oids], rowMode: 'array',
        })
        for (const [oid, name, category] of found.rows as [number, string, string][]) looked.set(Number(oid), pgTypeFromCatalogue(name, category))
      }
      for (const u of unnamed.splice(0)) u.set.columns[u.index] = pgColumn(u.name, u.oid, looked)
    }
    let broken = false
    try {
      let status = 'I'
      let cancelling: Promise<void> | undefined
      // Waiting for a connection can take a while, and the stop may have come in the meantime.
      if (signal?.aborted) markCancelled(result)
      else await new Promise<void>((resolve) => {
        const running = new pg.Query({ text: sql, rowMode: 'array' } as never)
        const sets = new Map<unknown, ResultSet>()
        const collector = new RowCollector(result, maxRows)
        let stopped = false
        let settled = false
        const onReady = (m: { status: string }) => {
          status = m.status
          finish()
        }
        internals.connection.on('readyForQuery', onReady)
        const finish = () => {
          if (settled) return
          settled = true
          internals.connection.removeListener('readyForQuery', onReady)
          signal?.removeEventListener('abort', onAbort)
          resolve()
        }
        const stop = () => {
          if (stopped || settled) return
          stopped = true
          cancelling = cancel(internals)
        }
        const onAbort = () => {
          if (!settled) markCancelled(result)
          stop()
        }
        signal?.addEventListener('abort', onAbort)
        const setFor = (res: PgFields) => {
          let set = sets.get(res)
          if (!set) {
            const made: ResultSet = { columns: res.fields.map((f) => pgColumn(f.name, f.dataTypeID, looked)), rows: [], truncated: false }
            made.columns.forEach((column, index) => {
              if (!column.type) unnamed.push({ set: made, index, name: column.name, oid: res.fields[index].dataTypeID })
            })
            set = made
            sets.set(res, set)
            result.resultSets.push(set)
          }
          return set
        }
        // Listening for rows (rather than awaiting the query) stops the driver buffering the whole result.
        running.on('row', (row: unknown[], res?: unknown) => {
          if (collector.push(setFor(res as PgFields), () => row.map(toCell)) === 'stop') stop()
        })
        running.on('error', (err: Error & { position?: string; code?: string }) => {
          // 57014 is the server confirming a cancel we asked for.
          if (!(stopped && err.code === '57014')) {
            result.error = { message: err.message, line: err.position ? lineAt(sql, Number(err.position) - 1) : undefined }
          }
          // The server's ready signal normally ends the run; this covers a connection that died.
          setTimeout(finish, 3000)
        })
        running.on('end', (final: unknown) => {
          for (const res of (Array.isArray(final) ? final : [final]) as PgFinal[]) {
            if (!res) continue
            if (res.fields?.length) setFor(res as PgFields)
            else if (/^(INSERT|UPDATE|DELETE|MERGE|COPY)$/.test(res.command ?? '')) result.rowsAffected = (result.rowsAffected ?? 0) + (res.rowCount ?? 0)
          }
        })
        client.query(running)
      })
      // A cancel that lands late must not hit the clean-up below, or the next run on this connection.
      await cancelling
      if (status !== 'I' && !config.readOnly) result.messages.push(ROLLED_BACK)
      // A type made inside the run is gone once the run is undone, so its name is read first when it can be.
      if (status !== 'E') await nameTypes().catch(() => undefined)
      // Leave the session clean: no open or failed transaction, no changed settings, no held locks.
      await client.query('ROLLBACK')
      if (unnamed.length > 0) await nameTypes().catch(() => undefined)
      await client.query('DISCARD ALL')
    } catch (err) {
      broken = true
      result.error ??= { message: message(err) }
    } finally {
      client.release(broken)
    }
    if (result.resultSets.length > 0 && !result.error) result.rowsAffected = null
    return result
  }

  const rows = async (sql: string) => (await pool.query({ text: sql, rowMode: 'array' })).rows.map((r: unknown[]) => r.map(toCell))

  return {
    query,
    async schema() {
      const [columns, keys] = await Promise.all([
        rows(`
          SELECT n.nspname, c.relname, CASE WHEN c.relkind IN ('v', 'm') THEN 'view' ELSE 'table' END, a.attname,
                 format_type(a.atttypid, a.atttypmod), NOT a.attnotnull,
                 EXISTS (SELECT 1 FROM pg_index i WHERE i.indrelid = c.oid AND i.indisprimary AND a.attnum = ANY (i.indkey))
          FROM pg_class c
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum > 0 AND NOT a.attisdropped
          WHERE c.relkind IN ('r', 'v', 'm', 'f', 'p')
            AND n.nspname NOT IN ('pg_catalog', 'information_schema') AND n.nspname NOT LIKE 'pg\\_toast%' AND n.nspname NOT LIKE 'pg\\_temp%'
          ORDER BY n.nspname, c.relname, a.attnum`),
        rows(`
          SELECT n.nspname, c.relname, a.attname, fn.nspname, fc.relname, fa.attname
          FROM pg_constraint k
          JOIN pg_class c ON c.oid = k.conrelid
          JOIN pg_namespace n ON n.oid = c.relnamespace
          JOIN pg_class fc ON fc.oid = k.confrelid
          JOIN pg_namespace fn ON fn.oid = fc.relnamespace
          CROSS JOIN LATERAL unnest(k.conkey, k.confkey) AS u(col, fcol)
          JOIN pg_attribute a ON a.attrelid = c.oid AND a.attnum = u.col
          JOIN pg_attribute fa ON fa.attrelid = fc.oid AND fa.attnum = u.fcol
          WHERE k.contype = 'f'`).catch(() => []),
      ])
      return buildSchema(columns, keys)
    },
    async close() { await pool.end() },
  }
}
