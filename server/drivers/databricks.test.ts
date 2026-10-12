import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { ConnectionConfig } from '../../shared/types.ts'
import { databricksCell, databricksColumn, databricksDriver, warehouseId } from './databricks.ts'

/**
 * A stand-in for the Statement Execution API, written from its documentation. It checks what the
 * driver sends and answers in the documented shapes; it says nothing about a real warehouse.
 */
interface Seen { method: string; url: string; auth: string; body: Record<string, unknown> }
const seen: Seen[] = []
let server: http.Server
let host = ''

const columns = (...pairs: [string, string, string][]) => ({ schema: { columns: pairs.map(([name, type_name, type_text], position) => ({ name, type_name, type_text, position })) } })

function answer(request: Seen): { status?: number; body: unknown } {
  const statement = String(request.body.statement ?? '')
  const ok = (manifest: unknown, result: unknown) => ({ body: { statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest, result } })
  if (request.auth !== 'Bearer good-token') return { status: 403, body: { error_code: 'PERMISSION_DENIED', message: 'Invalid access token.' } }
  if (request.url === '/api/2.0/sql/statements/slow') return ok(columns(['n', 'INT', 'INT']), { data_array: [['7']] })
  if (request.url === '/api/2.0/sql/statements/forever') return { body: { statement_id: 'forever', status: { state: 'RUNNING' } } }
  if (request.url === '/chunk/1') return { body: { data_array: [['3'], ['4']], next_chunk_internal_link: '/chunk/2' } }
  if (request.url === '/chunk/2') return { body: { data_array: [['5']] } }
  if (request.url.endsWith('/cancel')) return { body: {} }
  if (/^select 1$/i.test(statement)) return ok(columns(['1', 'INT', 'INT']), { data_array: [['1']] })
  if (/types/.test(statement)) {
    return ok(
      columns(['id', 'LONG', 'BIGINT'], ['big', 'LONG', 'BIGINT'], ['price', 'DECIMAL', 'DECIMAL(10,2)'], ['ratio', 'DOUBLE', 'DOUBLE'], ['ok', 'BOOLEAN', 'BOOLEAN'],
        ['day', 'DATE', 'DATE'], ['name', 'STRING', 'STRING'], ['tags', 'ARRAY', 'ARRAY<STRING>'], ['gone', 'STRING', 'STRING']),
      { data_array: [['42', '9007199254740993', '19.90', '0.5', 'true', '2026-01-31', 'Ada', '["a","b"]', null]] })
  }
  if (/chunked/.test(statement)) return ok(columns(['n', 'INT', 'INT']), { data_array: [['1'], ['2']], next_chunk_internal_link: '/chunk/1' })
  if (/update/i.test(statement)) return ok(columns(['num_affected_rows', 'LONG', 'BIGINT'], ['num_inserted_rows', 'LONG', 'BIGINT']), { data_array: [['12', '0']] })
  if (/^use/i.test(statement)) return ok({ schema: { columns: [] } }, {})
  if (/slow/.test(statement)) return { body: { statement_id: 'slow', status: { state: 'PENDING' } } }
  if (/forever/.test(statement)) return { body: { statement_id: 'forever', status: { state: 'RUNNING' } } }
  if (/broken/.test(statement)) {
    return { body: { statement_id: 's2', status: { state: 'FAILED', error: { error_code: 'BAD_REQUEST', message: "[PARSE_SYNTAX_ERROR] Syntax error at or near 'broken'. SQLSTATE: 42601 (line 2, pos 0)" } } } }
  }
  if (/information_schema.columns/.test(statement)) {
    return ok({}, { data_array: [['sales', 'orders', 'MANAGED', 'id', 'bigint', 'NO'], ['sales', 'orders', 'MANAGED', 'customer_id', 'bigint', 'YES'], ['sales', 'customers', 'MANAGED', 'id', 'bigint', 'NO'], ['sales', 'recent', 'VIEW', 'id', 'bigint', 'YES']] })
  }
  if (/table_constraints/.test(statement)) {
    return ok({}, { data_array: [['PRIMARY KEY', 'sales', 'orders', 'id', null, null, null], ['FOREIGN KEY', 'sales', 'orders', 'customer_id', 'sales', 'customers', 'id']] })
  }
  return { status: 400, body: { message: `stand-in does not know: ${statement}` } }
}

beforeAll(async () => {
  server = http.createServer((req, res) => {
    let text = ''
    req.on('data', (piece) => { text += piece })
    req.on('end', () => {
      const request: Seen = { method: req.method ?? '', url: req.url ?? '', auth: req.headers.authorization ?? '', body: text ? JSON.parse(text) : {} }
      seen.push(request)
      const { status = 200, body } = answer(request)
      res.writeHead(status, { 'content-type': 'application/json' })
      res.end(JSON.stringify(body))
    })
  })
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  host = `127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => new Promise<void>((resolve) => { server.close(() => resolve()); server.closeAllConnections() }))

const config = (extra: Partial<ConnectionConfig> = {}): ConnectionConfig =>
  ({ id: 'd', name: 'd', dialect: 'databricks', host, httpPath: '/sql/1.0/warehouses/wh42', readOnly: true, ...extra })
const open = (extra?: Partial<ConnectionConfig>, token = 'good-token') => databricksDriver(config(extra), token)
const statements = () => seen.filter((s) => s.method === 'POST' && s.url === '/api/2.0/sql/statements').map((s) => s.body)

describe('databricks driver against a stand-in', () => {
  it('sends the statement to the warehouse with the catalog, schema and limits', async () => {
    seen.length = 0
    const driver = await open({ database: 'main', schema: 'sales' })
    const result = await driver.query('SELECT 1', 500)
    expect(result.error).toBeUndefined()
    expect(result.resultSets[0].rows).toEqual([[1]])
    expect(statements()[0]).toMatchObject({ statement: 'SELECT 1', warehouse_id: 'wh42', catalog: 'main', schema: 'sales', disposition: 'INLINE', format: 'JSON_ARRAY', row_limit: 501, on_wait_timeout: 'CONTINUE' })
    expect(seen[0].auth).toBe('Bearer good-token')
  })

  it('turns the text it is sent into numbers and booleans where that is exact', async () => {
    const { resultSets } = await (await open()).query('SELECT * FROM types', 500)
    expect(resultSets[0].rows[0]).toEqual([42, '9007199254740993', '19.90', 0.5, true, '2026-01-31', 'Ada', '["a","b"]', null])
    expect(resultSets[0].columns.map((c) => c.kind)).toEqual(['integer', 'integer', 'decimal', 'float', 'bool', 'date', 'text', 'json', 'text'])
    expect(resultSets[0].columns[2]).toEqual({ name: 'price', type: 'decimal(10,2)', numeric: true, kind: 'decimal' })
  })

  it('follows a result that comes in several pieces, and stops at the row limit', async () => {
    const all = await (await open()).query('SELECT n FROM chunked', 500)
    expect(all.resultSets[0].rows).toEqual([[1], [2], [3], [4], [5]])
    expect(all.resultSets[0].truncated).toBe(false)
    const some = await (await open()).query('SELECT n FROM chunked', 3)
    expect(some.resultSets[0].rows).toEqual([[1], [2], [3]])
    expect(some.resultSets[0].truncated).toBe(true)
  })

  it('runs a script one statement at a time and reports changed rows as a count', async () => {
    seen.length = 0
    const result = await (await open()).query("USE CATALOG main;\n-- a note; with a semicolon\nUPDATE t SET a = ';' WHERE b = 1;\nSELECT 1;", 500)
    expect(result.error).toBeUndefined()
    expect(statements().map((s) => s.statement)).toEqual(['USE CATALOG main', "-- a note; with a semicolon\nUPDATE t SET a = ';' WHERE b = 1", 'SELECT 1'])
    expect(result.rowsAffected).toBe(12)
    expect(result.resultSets).toHaveLength(1)
  })

  it('waits for a statement that is still running', async () => {
    const result = await (await open()).query('SELECT slow', 500)
    expect(result.resultSets[0].rows).toEqual([[7]])
  })

  it('reports an error against the line of the whole script, and runs nothing after it', async () => {
    seen.length = 0
    const result = await (await open()).query('SELECT 1;\n\nSELECT\nbroken;\nSELECT 1;', 500)
    expect(result.error).toEqual({ message: expect.stringContaining('PARSE_SYNTAX_ERROR'), line: 4 })
    expect(result.resultSets).toHaveLength(1)
    expect(statements()).toHaveLength(2)
  })

  it('cancels the statement on the warehouse when the run is stopped', async () => {
    seen.length = 0
    const controller = new AbortController()
    const running = (await open()).query('SELECT forever', 500, controller.signal)
    setTimeout(() => controller.abort(), 150)
    const result = await running
    expect(result.stopped).toBe(true)
    expect(result.error).toBeUndefined()
    await new Promise((resolve) => setTimeout(resolve, 100))
    expect(seen.some((s) => s.url === '/api/2.0/sql/statements/forever/cancel')).toBe(true)
  })

  it('explains a refused token', async () => {
    const result = await (await open({}, 'bad-token')).query('SELECT 1', 1)
    expect(result.error?.message).toMatch(/403.*Invalid access token.*Check the access token/)
  })

  it('reads tables, primary keys and foreign keys', async () => {
    const tables = await (await open()).schema()
    expect(tables.map((t) => [t.schema, t.name, t.kind])).toEqual([['sales', 'orders', 'table'], ['sales', 'customers', 'table'], ['sales', 'recent', 'view']])
    expect(tables[0].columns).toEqual([{ name: 'id', type: 'bigint', nullable: false, pk: true }, { name: 'customer_id', type: 'bigint', nullable: true, pk: false }])
    expect(tables[0].foreignKeys).toEqual([{ column: 'customer_id', refSchema: 'sales', refTable: 'customers', refColumn: 'id' }])
  })

  it('refuses to open without what it needs, and says what that is', async () => {
    await expect(databricksDriver(config({ host: '' }), 't')).rejects.toThrow(/workspace host/)
    await expect(databricksDriver(config({ httpPath: '' }), 't')).rejects.toThrow(/HTTP path/)
    await expect(databricksDriver(config(), '')).rejects.toThrow(/access token/)
  })
})

describe('databricks values', () => {
  it('takes the warehouse id from a path or an id', () => {
    expect(warehouseId('/sql/1.0/warehouses/abc123')).toBe('abc123')
    expect(warehouseId('sql/1.0/warehouses/abc123/')).toBe('abc123')
    expect(warehouseId(' abc123 ')).toBe('abc123')
  })

  it('keeps what a number cannot hold as text', () => {
    expect(databricksCell('NaN', 'float')).toBe('NaN')
    expect(databricksCell('Infinity', 'float')).toBe('Infinity')
    expect(databricksCell('-12', 'integer')).toBe(-12)
    expect(databricksCell('123456789012345678901234567890', 'integer')).toBe('123456789012345678901234567890')
    expect(databricksCell('false', 'bool')).toBe(false)
    expect(databricksCell('007', 'text')).toBe('007')
  })

  it('leaves a type it does not know with no kind', () => {
    expect(databricksColumn({ name: 'x', type_name: 'USER_DEFINED_TYPE', type_text: 'GEOGRAPHY' })).toEqual({ name: 'x', type: 'geography' })
  })
})
