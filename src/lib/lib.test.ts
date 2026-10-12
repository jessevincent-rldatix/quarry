import { describe, expect, it } from 'vitest'
import { readOnlyViolation, riskyWrite, splitBatches } from '@shared/readonly'
import { answerParts } from './answerParts'
import { parseConnectionString } from './connectionString'
import { toCsv, toMarkdown } from './export'
import { buildSql, columnRef, emptyBuilder, identPart } from './sqlBuilder'
import { statementAt } from './statements'
import { parseVars, renderSql } from './template'

describe('template variables', () => {
  it('finds each variable once, with type and default', () => {
    expect(parseVars('a = {{x}} AND b = {{n:number=5}} AND c = {{x}}')).toEqual([
      { name: 'x', type: 'text', default: undefined },
      { name: 'n', type: 'number', default: '5' },
    ])
  })

  it('quotes text so it cannot break out of the string', () => {
    const { sql, errors } = renderSql('SELECT * FROM t WHERE name = {{name}}', { name: "O'Brien'; DROP TABLE t; --" }, 'postgres')
    expect(errors).toEqual([])
    expect(sql).toBe("SELECT * FROM t WHERE name = 'O''Brien''; DROP TABLE t; --'")
  })

  it('uses defaults, validates numbers and dates, and quotes identifiers per dialect', () => {
    expect(renderSql('SELECT * FROM {{t:ident}}', { t: 'ops.Service Log' }, 'mssql').sql).toBe('SELECT * FROM [ops].[Service Log]')
    expect(renderSql('SELECT TOP ({{n:number=10}}) * FROM {{t:ident}}', { t: 'dbo.orders' }, 'mssql').sql).toBe('SELECT TOP (10) * FROM [dbo].[orders]')
    expect(renderSql('{{n:number}}', { n: '1; DROP' }, 'sqlite').errors).toEqual(['n must be a number'])
    expect(renderSql('{{d:date}}', { d: '2026-01-31' }, 'sqlite').sql).toBe("'2026-01-31'")
    expect(renderSql('{{d:date}}', {}, 'sqlite').errors).toEqual(['d is empty'])
    expect(renderSql('IN ({{v:list}})', { v: 'a, 2, c' }, 'mssql').sql).toBe("IN (N'a', N'2', N'c')")
    expect(renderSql('IN ({{v:list}})', { v: '1, 2' }, 'mssql').sql).toBe('IN (1, 2)')
  })
})

describe('read-only guard', () => {
  it('allows reads', () => {
    expect(readOnlyViolation("SELECT REPLACE(name, 'delete', '') AS last_update FROM t; WITH x AS (SELECT 1) SELECT * FROM x", 'postgres')).toBeNull()
    expect(readOnlyViolation('-- drop table t\nSELECT 1', 'mssql')).toBeNull()
    expect(readOnlyViolation('SELECT [update], "delete" FROM t', 'mssql')).toBeNull()
  })

  it('refuses writes, including ones hidden behind a SELECT', () => {
    expect(readOnlyViolation('DELETE FROM t', 'sqlite')).not.toBeNull()
    expect(readOnlyViolation('SELECT 1; DROP TABLE t', 'mssql')).not.toBeNull()
    expect(readOnlyViolation('SELECT * INTO backup FROM t', 'mssql')).not.toBeNull()
    expect(readOnlyViolation('WITH gone AS (DELETE FROM t RETURNING *) SELECT * FROM gone', 'postgres')).not.toBeNull()
    expect(readOnlyViolation("EXEC('DROP TABLE t')", 'mssql')).not.toBeNull()
    expect(readOnlyViolation('SELECT 1; /*!50000 DELETE FROM t */', 'mysql')).not.toBeNull()
    expect(readOnlyViolation('SELECT 1 /* plain comment */', 'mysql')).toBeNull()
  })

  it('warns about UPDATE and DELETE with no WHERE', () => {
    expect(riskyWrite('UPDATE t SET a = 1', 'mssql')).not.toBeNull()
    expect(riskyWrite("DELETE FROM t WHERE note = 'x'", 'mssql')).toBeNull()
    expect(riskyWrite('DELETE FROM t -- where id = 1', 'postgres')).not.toBeNull()
  })

  it('splits SQL Server batches on GO, keeping line numbers', () => {
    const batches = splitBatches("SELECT 1\nGO\nSELECT 'GO'\ngo\nSELECT 3")
    expect(batches.map((b) => b.sql.trim())).toEqual(['SELECT 1', "SELECT 'GO'", 'SELECT 3'])
  })
})

describe('editor helpers', () => {
  it('finds the statement under the cursor', () => {
    const sql = "SELECT 1;\nSELECT ';' AS semi;\nSELECT 3"
    expect(statementAt(sql, sql.indexOf('semi'), 'postgres')?.text.trim()).toBe("SELECT ';' AS semi;")
    expect(statementAt(sql, sql.length, 'postgres')?.text.trim()).toBe('SELECT 3')
  })

  it('separates the SQL in an answer from the prose around it', () => {
    expect(answerParts('Try this:\n```sql\nSELECT 1;\n```\nIt returns one row.')).toEqual([
      { kind: 'text', text: 'Try this:' }, { kind: 'sql', text: 'SELECT 1;' }, { kind: 'text', text: 'It returns one row.' },
    ])
    expect(answerParts('```\nSELECT 2')).toEqual([{ kind: 'sql', text: 'SELECT 2' }])
  })
})

describe('query builder', () => {
  const tables = [
    { schema: '', name: 'orders', kind: 'table' as const, columns: [{ name: 'id', type: 'INTEGER', nullable: false, pk: true }, { name: 'status', type: 'TEXT', nullable: false, pk: false }, { name: 'total', type: 'REAL', nullable: false, pk: false }] },
  ]
  const state = { ...emptyBuilder(), table: 'orders', columns: [columnRef('orders', 'id'), columnRef('orders', 'total')], sortBy: columnRef('orders', 'total'), sortDesc: true, filters: [
    { id: '1', column: columnRef('orders', 'status'), op: 'eq' as const, value: 'shipped' },
    { id: '2', column: columnRef('orders', 'total'), op: 'ge' as const, value: '50' },
  ] }

  it('writes LIMIT for most dialects and TOP for SQL Server', () => {
    expect(buildSql(state, tables, 'sqlite')).toBe("SELECT id,\n       total\nFROM orders\nWHERE status = 'shipped'\n  AND total >= 50\nORDER BY total DESC\nLIMIT 100;")
    expect(buildSql(state, tables, 'mssql')).toContain('SELECT TOP (100) id')
  })

  it('quotes reserved words, odd names and mixed case where the database needs it', () => {
    expect(identPart('order', 'mssql')).toBe('[order]')
    expect(identPart('Cost (GBP)', 'mssql')).toBe('[Cost (GBP)]')
    expect(identPart('MixedCase', 'postgres')).toBe('"MixedCase"')
    expect(identPart('MixedCase', 'mssql')).toBe('MixedCase')
    expect(identPart('user', 'postgres')).toBe('"user"')
    expect(identPart('total', 'postgres')).toBe('total')
  })

  it('handles awkward table names, wildcards in values and empty lists', () => {
    const log = { schema: 'ops', name: 'Service Log', kind: 'table' as const, columns: [{ name: 'order', type: 'int', nullable: true, pk: false }, { name: 'garage', type: 'nvarchar(80)', nullable: true, pk: false }] }
    const s = { ...emptyBuilder(), table: 'ops.Service Log', limit: '1.5', columns: [columnRef('ops.Service Log', 'order')], filters: [
      { id: '1', column: columnRef('ops.Service Log', 'garage'), op: 'contains' as const, value: '50%_[x' },
      { id: '2', column: columnRef('ops.Service Log', 'order'), op: 'in' as const, value: ' , ' },
      { id: '3', column: columnRef('ops.Service Log', 'order'), op: 'starts' as const, value: '1' },
    ] }
    expect(buildSql(s, [log], 'mssql')).toBe("SELECT [order]\nFROM ops.[Service Log]\nWHERE garage LIKE N'%50[%][_][[]x%'\n  AND CAST([order] AS nvarchar(max)) LIKE N'1%';")
    expect(buildSql({ ...s, filters: [s.filters[0]] }, [log], 'postgres')).toContain("LIKE '%50\\%\\_[x%' ESCAPE '\\'")
  })
})

describe('export and connection strings', () => {
  const set = { columns: [{ name: 'a', type: '' }, { name: 'b', type: '' }], rows: [], truncated: false }
  it('escapes CSV and Markdown', () => {
    expect(toCsv(set, [['x,y', null], ['say "hi"', 2]])).toBe('a,b\r\n"x,y",\r\n"say ""hi""",2')
    expect(toMarkdown(set, [['p|q', null]])).toBe('| a | b |\n| --- | --- |\n| p\\|q | *NULL* |')
  })

  it('parses ADO and URL connection strings', () => {
    expect(parseConnectionString('Server=127.0.0.1,1433;Database=shop;User Id=someone;Password=secret;Encrypt=True;TrustServerCertificate=True')).toEqual({
      dialect: 'mssql', host: '127.0.0.1', port: 1433, database: 'shop', user: 'someone', password: 'secret', encrypt: true, trustServerCertificate: true,
    })
    expect(parseConnectionString('postgres://bob:pw@db.local:5433/shop')).toMatchObject({ dialect: 'postgres', host: 'db.local', port: 5433, database: 'shop', user: 'bob', password: 'pw' })
  })
})
