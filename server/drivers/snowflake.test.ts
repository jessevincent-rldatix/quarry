import { Readable } from 'node:stream'
import { describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '../../shared/types.ts'
import { accountName, snowflakeCell, snowflakeColumn, snowflakeDriver, snowflakeLogin } from './snowflake.ts'

const column = (name: string, type: string, scale = 0, precision = 38) => ({ getName: () => name, getType: () => type, getScale: () => scale, getPrecision: () => precision })

/**
 * A stand-in for the Snowflake driver library, shaped like the parts of it this file calls. It
 * checks how those calls are made; it says nothing about a real account.
 */
function fakeSdk(script: (sql: string) => { columns?: ReturnType<typeof column>[]; rows?: unknown[][]; affected?: number; error?: string; hang?: boolean }) {
  const log = { options: undefined as Record<string, unknown> | undefined, connected: '', executed: [] as string[], cancelled: [] as string[], destroyed: false, logLevel: '' }
  const sdk = {
    configure: (options: { logLevel: string }) => { log.logLevel = options.logLevel },
    createConnection: (options: Record<string, unknown>) => {
      log.options = options
      return {
        connect: (done: (err: Error | undefined) => void) => { log.connected = 'connect'; done(options.password === 'wrong' ? new Error('Incorrect username or password was specified.') : undefined) },
        connectAsync: async (done: (err: Error | undefined) => void) => { log.connected = 'connectAsync'; done(undefined) },
        destroy: (done: (err: Error | undefined) => void) => { log.destroyed = true; done(undefined) },
        execute: (request: { sqlText: string; rowMode: string; streamResult: boolean; fetchAsString: string[]; complete: (err: Error | undefined, statement: never) => void }) => {
          log.executed.push(request.sqlText)
          expect(request).toMatchObject({ rowMode: 'array', streamResult: true, fetchAsString: ['Number', 'Date'] })
          const plan = script(request.sqlText)
          const statement = {
            getColumns: () => plan.columns,
            getNumUpdatedRows: () => plan.affected ?? -1,
            streamRows: () => Readable.from(plan.rows ?? []),
            cancel: (done?: (err: Error | undefined) => void) => { log.cancelled.push(request.sqlText); done?.(undefined) },
          }
          if (!plan.hang) setTimeout(() => request.complete(plan.error ? new Error(plan.error) : undefined, statement as never), 5)
          return statement
        },
      }
    },
  }
  return { log, load: async () => sdk as never }
}

const config = (extra: Partial<ConnectionConfig> = {}): ConnectionConfig =>
  ({ id: 's', name: 's', dialect: 'snowflake', host: 'myorg-myaccount', user: 'ADA', readOnly: true, ...extra })

describe('snowflake sign-in', () => {
  it('reads the account from whatever was pasted', () => {
    expect(accountName('myorg-myaccount')).toBe('myorg-myaccount')
    expect(accountName('https://xy12345.eu-west-1.snowflakecomputing.com/console')).toBe('xy12345.eu-west-1')
    expect(accountName(' MYORG-ACCT.snowflakecomputing.com ')).toBe('MYORG-ACCT')
  })

  it('signs in with a password or token, and passes on where to run', () => {
    expect(snowflakeLogin(config({ warehouse: 'WH', database: 'DB', schema: 'PUBLIC', role: 'ANALYST' }), 'pw')).toMatchObject({
      account: 'myorg-myaccount', username: 'ADA', password: 'pw', warehouse: 'WH', database: 'DB', schema: 'PUBLIC', role: 'ANALYST',
    })
    expect(snowflakeLogin(config(), 'pw')).not.toHaveProperty('warehouse')
  })

  it('signs in through the browser without a password', () => {
    const login = snowflakeLogin(config({ auth: 'sso' }), '')
    expect(login).toMatchObject({ authenticator: 'EXTERNALBROWSER' })
    expect(login).not.toHaveProperty('password')
  })

  it('signs in with a key file, with or without a passphrase', () => {
    expect(snowflakeLogin(config({ auth: 'keypair', keyFile: 'C:\\keys\\k.p8' }), 'phrase')).toMatchObject({ authenticator: 'SNOWFLAKE_JWT', privateKeyPath: 'C:\\keys\\k.p8', privateKeyPass: 'phrase' })
    expect(snowflakeLogin(config({ auth: 'keypair', keyFile: 'k.p8' }), '')).not.toHaveProperty('privateKeyPass')
  })

  it('says what is missing', () => {
    expect(() => snowflakeLogin(config({ host: '' }), 'pw')).toThrow(/account identifier/)
    expect(() => snowflakeLogin(config({ user: '' }), 'pw')).toThrow(/user name/)
    expect(() => snowflakeLogin(config(), '')).toThrow(/password or access token/)
    expect(() => snowflakeLogin(config({ auth: 'keypair' }), '')).toThrow(/private key file/)
  })
})

describe('snowflake values', () => {
  it('names exact numbers by their precision and tells integers from decimals', () => {
    expect(snowflakeColumn(column('ID', 'fixed', 0, 38))).toEqual({ name: 'ID', type: 'number(38,0)', numeric: true, kind: 'integer' })
    expect(snowflakeColumn(column('PRICE', 'fixed', 2, 10))).toEqual({ name: 'PRICE', type: 'number(10,2)', numeric: true, kind: 'decimal' })
    expect(snowflakeColumn(column('R', 'real'))).toMatchObject({ kind: 'float', numeric: true })
    expect(['timestamp_ntz', 'timestamp_tz', 'date', 'time'].map((t) => snowflakeColumn(column('c', t)).kind)).toEqual(Array(4).fill('date'))
    expect(['variant', 'object', 'array'].map((t) => snowflakeColumn(column('c', t)).kind)).toEqual(Array(3).fill('json'))
    expect(snowflakeColumn(column('g', 'geography'))).toEqual({ name: 'g', type: 'geography' })
  })

  it('turns numbers sent as text back into numbers only where that is exact', () => {
    expect(snowflakeCell('42', 'integer')).toBe(42)
    expect(snowflakeCell('12345678901234567890123456789012345678', 'integer')).toBe('12345678901234567890123456789012345678')
    expect(snowflakeCell('19.90', 'decimal')).toBe('19.90')
    expect(snowflakeCell('0.5', 'float')).toBe(0.5)
    expect(snowflakeCell('NaN', 'float')).toBe('NaN')
    expect(snowflakeCell('2026-01-31 10:00:00.000', 'date')).toBe('2026-01-31 10:00:00.000')
    expect(snowflakeCell({ a: 1 }, 'json')).toBe('{"a":1}')
    expect(snowflakeCell(true, 'bool')).toBe(true)
    expect(snowflakeCell(null, 'text')).toBeNull()
  })
})

describe('snowflake driver against a stand-in', () => {
  it('connects quietly, the ordinary way for a password and the waiting way for the browser', async () => {
    const password = fakeSdk(() => ({}))
    await snowflakeDriver(config(), 'pw', password.load)
    expect(password.log).toMatchObject({ connected: 'connect', logLevel: 'OFF' })
    const browser = fakeSdk(() => ({}))
    await snowflakeDriver(config({ auth: 'sso' }), '', browser.load)
    expect(browser.log.connected).toBe('connectAsync')
  })

  it('passes on a refused sign-in', async () => {
    await expect(snowflakeDriver(config(), 'wrong', fakeSdk(() => ({})).load)).rejects.toThrow(/Incorrect username or password/)
  })

  it('runs a script one statement at a time: rows, changed rows, then stops at an error on the right line', async () => {
    const fake = fakeSdk((sql) => {
      if (/^select n/i.test(sql)) return { columns: [column('N', 'fixed'), column('NAME', 'text')], rows: [['1', 'a'], ['2', 'b'], ['3', 'c']] }
      if (/^update/i.test(sql)) return { affected: 4 }
      return { error: "SQL compilation error:\nsyntax error line 2 at position 0 unexpected 'oops'." }
    })
    const driver = await snowflakeDriver(config(), 'pw', fake.load)
    const result = await driver.query("SELECT n, name FROM t;\nUPDATE t SET a = ';';\n\nSELECT\noops;\nSELECT 9;", 2)
    expect(fake.log.executed).toEqual(['SELECT n, name FROM t', "UPDATE t SET a = ';'", 'SELECT\noops'])
    expect(result.resultSets).toEqual([{ columns: [{ name: 'N', type: 'number(38,0)', numeric: true, kind: 'integer' }, { name: 'NAME', type: 'text', kind: 'text' }], rows: [[1, 'a'], [2, 'b']], truncated: true }])
    expect(result.rowsAffected).toBe(4)
    expect(result.error).toEqual({ message: expect.stringContaining('syntax error'), line: 5 })
  })

  it('cancels the statement on the warehouse when the run is stopped', async () => {
    const fake = fakeSdk(() => ({ hang: true }))
    const driver = await snowflakeDriver(config(), 'pw', fake.load)
    const controller = new AbortController()
    const running = driver.query('SELECT slow', 100, controller.signal)
    setTimeout(() => controller.abort(), 20)
    const result = await running
    expect(result).toMatchObject({ stopped: true, resultSets: [] })
    expect(result.error).toBeUndefined()
    expect(fake.log.cancelled).toEqual(['SELECT slow'])
  })

  it('reads tables with primary and foreign keys, and still lists tables when keys cannot be read', async () => {
    const tables = [['SALES', 'ORDERS', 'BASE TABLE', 'ID', 'NUMBER(38,0)', 'NO'], ['SALES', 'ORDERS', 'BASE TABLE', 'CUSTOMER_ID', 'NUMBER(38,0)', 'YES'], ['SALES', 'RECENT', 'VIEW', 'ID', 'NUMBER(38,0)', 'YES']]
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map((n) => column(n, 'text'))
    const withKeys = fakeSdk((sql) => {
      if (/SHOW PRIMARY KEYS IN DATABASE/.test(sql)) return { columns: ['created_on', 'database_name', 'schema_name', 'table_name', 'column_name'].map((n) => column(n, 'text')), rows: [['x', 'DB', 'SALES', 'ORDERS', 'ID']] }
      if (/SHOW IMPORTED KEYS IN DATABASE/.test(sql)) {
        return { columns: ['pk_schema_name', 'pk_table_name', 'pk_column_name', 'fk_schema_name', 'fk_table_name', 'fk_column_name'].map((n) => column(n, 'text')), rows: [['SALES', 'CUSTOMERS', 'ID', 'SALES', 'ORDERS', 'CUSTOMER_ID']] }
      }
      return { columns: six, rows: tables }
    })
    const schema = await (await snowflakeDriver(config({ database: 'DB' }), 'pw', withKeys.load)).schema()
    expect(schema.map((t) => [t.schema, t.name, t.kind])).toEqual([['SALES', 'ORDERS', 'table'], ['SALES', 'RECENT', 'view']])
    expect(schema[0].columns.map((c) => [c.name, c.pk, c.nullable])).toEqual([['ID', true, false], ['CUSTOMER_ID', false, true]])
    expect(schema[0].foreignKeys).toEqual([{ column: 'CUSTOMER_ID', refSchema: 'SALES', refTable: 'CUSTOMERS', refColumn: 'ID' }])

    const noKeys = fakeSdk((sql) => (/^SHOW/.test(sql) ? { error: 'Insufficient privileges' } : { columns: six, rows: tables }))
    expect(await (await snowflakeDriver(config({ database: 'DB' }), 'pw', noKeys.load)).schema()).toHaveLength(2)
  })

  it('asks for a database when the tables cannot be listed without one', async () => {
    const fake = fakeSdk(() => ({ error: 'Cannot perform SELECT. This session does not have a current database. Call USE DATABASE.' }))
    await expect((await snowflakeDriver(config(), 'pw', fake.load)).schema()).rejects.toThrow(/Fill in "Database"/)
  })

  it('ends the session on close', async () => {
    const fake = fakeSdk(() => ({}))
    await (await snowflakeDriver(config(), 'pw', fake.load)).close()
    expect(fake.log.destroyed).toBe(true)
  })
})
