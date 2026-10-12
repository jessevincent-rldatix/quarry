import { describe, expect, it } from 'vitest'
import type { Dialect, SchemaTable } from '@shared/types'
import { scan } from '@shared/sqlScan'
import { BUILTIN_TEMPLATES, templateSql } from './builtins'
import { parseConnectionString } from './connectionString'
import { formatSql } from './formatSql'
import { groupBySchema, localTables } from './schema'
import { buildQuery, columnRef, emptyBuilder, previewSql, tableKey } from './sqlBuilder'
import { parseVars, renderSql } from './template'

const CLOUD: Dialect[] = ['snowflake', 'databricks']
const table = (schema: string, name: string, columns: [string, string][]): SchemaTable =>
  ({ schema, name, kind: 'table', columns: columns.map(([n, type]) => ({ name: n, type, nullable: true, pk: false })), foreignKeys: [] })

describe('Snowflake and Databricks: variables', () => {
  it('quotes and escapes a text value for each', () => {
    expect(renderSql('SELECT * FROM t WHERE name = {{name}}', { name: "O'Brien" }, 'snowflake').sql).toBe("SELECT * FROM t WHERE name = 'O''Brien'")
    expect(renderSql('SELECT * FROM t WHERE name = {{name}}', { name: "O'Brien" }, 'databricks').sql).toBe("SELECT * FROM t WHERE name = 'O\\'Brien'")
  })

  it('a value placed inside quotes the query wrote cannot break out of them', () => {
    const attack = "\\' OR 1=1 --"
    for (const dialect of CLOUD) {
      const { sql, errors } = renderSql("SELECT * FROM t WHERE name LIKE '%{{name}}%' AND 1 = 1", { name: attack }, dialect)
      expect(errors).toEqual([])
      const { tokens, unterminated } = scan(sql, dialect)
      expect(unterminated, dialect).toBeNull()
      expect(tokens.filter((t) => t.kind === 'string'), dialect).toHaveLength(1)
      // The words after the string are still the query's own, and the value added none.
      expect(tokens.filter((t) => t.kind === 'word').map((t) => t.text), dialect).toEqual(['select', 'from', 't', 'where', 'name', 'like', 'and'])
    }
  })

  it('Databricks: a value inside double quotes or an r-string stays inside', () => {
    const inDouble = renderSql('SELECT "{{v}}" AS x', { v: 'a"b\\' }, 'databricks')
    expect(scan(inDouble.sql, 'databricks').tokens.map((t) => t.kind)).toEqual(['word', 'string', 'word', 'word'])
    expect(renderSql("SELECT r'{{v}}' AS x", { v: 'C:\\dir' }, 'databricks').sql).toBe("SELECT r'C:\\dir' AS x")
    expect(renderSql("SELECT r'{{v}}' AS x", { v: "it's" }, 'databricks').errors[0]).toMatch(/r'\.\.\.' string/)
  })

  it('Snowflake: a value inside $$ is refused, and one inside a quoted name is kept inside', () => {
    expect(renderSql('SELECT $$ {{v}} $$', { v: 'x' }, 'snowflake').errors[0]).toMatch(/\$\$ string/)
    expect(renderSql('SELECT * FROM "{{t}}"', { t: 'a"b' }, 'snowflake').sql).toBe('SELECT * FROM "a""b"')
  })

  it('finds variables but not ones in comments', () => {
    expect(parseVars('SELECT {{a}} // {{b}}\n-- {{c}}\n/* {{d}} */', 'snowflake').map((v) => v.name)).toEqual(['a'])
    expect(parseVars('SELECT {{a}} /* /* {{b}} */ {{c}} */', 'databricks').map((v) => v.name)).toEqual(['a'])
  })
})

describe('Snowflake and Databricks: builder and previews', () => {
  it('previews a table with the right quoting', () => {
    expect(previewSql(table('SALES', 'ORDERS', []), 'snowflake')).toBe('SELECT *\nFROM SALES.ORDERS\nLIMIT 100;')
    expect(previewSql(table('SALES', 'Mixed Case', []), 'snowflake')).toBe('SELECT *\nFROM SALES."Mixed Case"\nLIMIT 100;')
    expect(previewSql(table('sales', 'order', []), 'databricks')).toBe('SELECT *\nFROM sales.`order`\nLIMIT 100;')
  })

  it('builds filters with ILIKE, real booleans and a text cast', () => {
    const orders = table('', 'ORDERS', [['ID', 'NUMBER(38,0)'], ['STATUS', 'VARCHAR(20)'], ['PAID', 'BOOLEAN']])
    const filters = (t: SchemaTable, [id, status, paid]: string[]) => ({
      ...emptyBuilder(), table: tableKey(t),
      filters: [
        { id: '1', column: columnRef(tableKey(t), status), op: 'contains' as const, value: '50%_off' },
        { id: '2', column: columnRef(tableKey(t), paid), op: 'eq' as const, value: 'yes' },
        { id: '3', column: columnRef(tableKey(t), id), op: 'contains' as const, value: '12' },
      ],
    })
    const snowflake = buildQuery(filters(orders, ['ID', 'STATUS', 'PAID']), [orders], 'snowflake')
    expect(snowflake.problems).toEqual([])
    expect(snowflake.sql).toContain("STATUS ILIKE '%50\\\\%\\\\_off%' ESCAPE '\\\\'")
    expect(snowflake.sql).toContain('PAID = TRUE')
    expect(snowflake.sql).toContain("CAST(ID AS varchar) ILIKE '%12%'")
    expect(scan(snowflake.sql, 'snowflake').unterminated).toBeNull()
    const lower = table('', 'orders', [['id', 'bigint'], ['status', 'string'], ['paid', 'boolean']])
    const databricks = buildQuery(filters(lower, ['id', 'status', 'paid']), [lower], 'databricks')
    expect(databricks.problems).toEqual([])
    expect(databricks.sql).toContain("CAST(id AS string) ILIKE '%12%'")
    expect(databricks.sql).toContain('paid = TRUE')
    expect(scan(databricks.sql, 'databricks').unterminated).toBeNull()
  })

  it('drops the schema the connection names, whatever its case', () => {
    const tables = [table('SALES', 'ORDERS', []), table('OPS', 'TRIPS', [])]
    expect(localTables(tables, { dialect: 'snowflake', database: 'DB', schema: 'sales' }).map((t) => t.schema)).toEqual(['', 'OPS'])
    expect(localTables(tables, { dialect: 'snowflake', database: 'DB' }).map((t) => t.schema)).toEqual(['SALES', 'OPS'])
    expect(localTables([table('sales', 'orders', [])], { dialect: 'databricks', schema: 'Sales' })[0].schema).toBe('')
  })
})

describe('grouping tables by schema', () => {
  it('files each table under its schema, bare tables first, schemas in the order they appear', () => {
    const tables = [table('arbiter', 'jobs', []), table('cartographer', 'maps', []), table('public', 'users', []), table('arbiter', 'runs', []), table('', 'notes', [])]
    expect(groupBySchema(tables).map((g) => [g.schema, g.tables.map((t) => t.name)])).toEqual([['', ['users', 'notes']], ['arbiter', ['jobs', 'runs']], ['cartographer', ['maps']]])
    expect(groupBySchema([])).toEqual([])
  })
})

describe('Snowflake and Databricks: templates, formatting, connection strings', () => {
  it('every built-in template either has SQL that scans cleanly or says it is not available', () => {
    const tables = [table('S', 'T', [['A', 'TEXT']])]
    const missing: Record<string, string[]> = { snowflake: [], databricks: [] }
    for (const dialect of CLOUD) {
      for (const template of BUILTIN_TEMPLATES) {
        const sql = templateSql(template, dialect, tables)
        if (sql === null) { missing[dialect].push(template.id); continue }
        expect(scan(sql, dialect, { variables: true }).unterminated, `${dialect} ${template.id}`).toBeNull()
        expect(sql, `${dialect} ${template.id}`).not.toMatch(/\bTOP \(|AS text\b|nvarchar/)
      }
    }
    expect(missing.snowflake).toEqual([])
    // Databricks keeps no row counts or sizes in its catalog, and its query history is not open to every login.
    expect(missing.databricks).toEqual(['builtin:row-counts', 'builtin:table-sizes', 'builtin:running'])
  })

  it('formats without changing what the query means', () => {
    expect(formatSql('select a, b from ORDERS where a = \'x\' // note\nlimit 5', 'snowflake')).toMatch(/SELECT\s+a,\s+b\s+FROM\s+ORDERS/)
    expect(formatSql('select `my col`, "text" from t limit 5', 'databricks')).toContain('`my col`')
  })

  it('reads a Snowflake address', () => {
    expect(parseConnectionString('snowflake://ada:s3cret@myorg-myaccount/SALES_DB/PUBLIC?warehouse=COMPUTE_WH&role=ANALYST')).toEqual({
      dialect: 'snowflake', host: 'myorg-myaccount', user: 'ada', password: 's3cret', database: 'SALES_DB', schema: 'PUBLIC', warehouse: 'COMPUTE_WH', role: 'ANALYST',
    })
    expect(parseConnectionString('snowflake://ada@myorg-myaccount/DB?authenticator=externalbrowser')).toMatchObject({ auth: 'sso', user: 'ada', database: 'DB' })
  })

  it('reads a Databricks JDBC address', () => {
    expect(parseConnectionString('jdbc:databricks://adb-123.7.azuredatabricks.net:443/default;transportMode=http;ssl=1;AuthMech=3;httpPath=/sql/1.0/warehouses/abc123;UID=token;PWD=dapi-secret')).toEqual({
      dialect: 'databricks', host: 'adb-123.7.azuredatabricks.net', httpPath: '/sql/1.0/warehouses/abc123', database: undefined, schema: undefined, password: 'dapi-secret',
    })
    expect(parseConnectionString('jdbc:databricks://h.cloud.databricks.com:443/sales;httpPath=/sql/1.0/warehouses/w;ConnCatalog=main')).toMatchObject({ database: 'main', schema: 'sales', password: undefined })
    expect(parseConnectionString('jdbc:databricks://h.cloud.databricks.com:443/default')).toBeNull()
  })
})
