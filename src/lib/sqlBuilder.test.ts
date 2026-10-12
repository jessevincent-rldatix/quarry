import { describe, expect, it } from 'vitest'
import { identPart, valueKind } from '@shared/dialect'
import type { Dialect, SchemaTable } from '@shared/types'
import { isDirty } from '@/store/selectors'
import { prepareRun } from './run'
import { buildQuery, columnRef, emptyBuilder, namedAfter, previewSql, suggestJoin, tableKey, tidyBuilder, type BuilderState } from './sqlBuilder'

const column = (name: string, type: string, pk = false) => ({ name, type, nullable: !pk, pk })
const table = (schema: string, name: string, columns: ReturnType<typeof column>[], foreignKeys: SchemaTable['foreignKeys'] = []): SchemaTable =>
  ({ schema, name, kind: 'table', columns, foreignKeys })

const vehicles = table('ops', 'vehicles', [column('vehicle_id', 'int', true), column('make', 'nvarchar(40)'), column('active', 'bit')])
const employees = table('hr', 'employees', [column('employee_id', 'int', true), column('name', 'nvarchar(80)')])
const trips = table('ops', 'trips', [column('trip_id', 'int', true), column('vehicle_id', 'int'), column('driver_id', 'int'), column('started_at', 'datetime2(7)'), column('status', 'nvarchar(20)')], [
  { column: 'vehicle_id', refSchema: 'ops', refTable: 'vehicles', refColumn: 'vehicle_id' },
  { column: 'driver_id', refSchema: 'hr', refTable: 'employees', refColumn: 'employee_id' },
])
const fleet = [vehicles, employees, trips]
const ref = (t: SchemaTable, c: string) => columnRef(tableKey(t), c)
const state = (change: Partial<BuilderState>): BuilderState => ({ ...emptyBuilder(), ...change })

describe('join suggestions', () => {
  it('follows a declared foreign key in either direction', () => {
    expect(suggestJoin([trips], vehicles)).toEqual({ from: ref(trips, 'vehicle_id'), to: 'vehicle_id' })
    // The parent is the starting table and the child is joined on: this used to produce no join at all.
    expect(suggestJoin([vehicles], trips)).toEqual({ from: ref(vehicles, 'vehicle_id'), to: 'vehicle_id' })
    // The column is not named after the table; only the foreign key knows.
    expect(suggestJoin([trips], employees)).toEqual({ from: ref(trips, 'driver_id'), to: 'employee_id' })
    expect(suggestJoin([employees], trips)).toEqual({ from: ref(employees, 'employee_id'), to: 'driver_id' })
  })

  it('falls back to a column named after the other table, both ways, and never joins id to id', () => {
    const customers = table('', 'customers', [column('id', 'INTEGER', true), column('name', 'TEXT')])
    const orders = table('', 'orders', [column('id', 'INTEGER', true), column('customer_id', 'INTEGER')])
    expect(suggestJoin([orders], customers)).toEqual({ from: ref(orders, 'customer_id'), to: 'id' })
    expect(suggestJoin([customers], orders)).toEqual({ from: ref(customers, 'id'), to: 'customer_id' })
    const unrelated = table('', 'products', [column('id', 'INTEGER', true), column('title', 'TEXT')])
    expect(suggestJoin([customers], unrelated)).toBeNull()
    expect(namedAfter(orders, customers)).toBe('customer_id')
  })

  it('can hang a second join off the first', () => {
    expect(suggestJoin([vehicles, trips], employees)).toEqual({ from: ref(trips, 'driver_id'), to: 'employee_id' })
  })
})

describe('built query', () => {
  it('writes every complete join and qualifies columns', () => {
    const { sql, problems } = buildQuery(state({
      table: 'ops.vehicles', columns: [ref(vehicles, 'make'), ref(employees, 'name')],
      joins: [
        { id: '1', table: 'ops.trips', from: ref(vehicles, 'vehicle_id'), to: 'vehicle_id' },
        { id: '2', table: 'hr.employees', from: ref(trips, 'driver_id'), to: 'employee_id' },
      ],
    }), fleet, 'mssql')
    expect(problems).toEqual([])
    expect(sql).toBe([
      'SELECT TOP (100) ops.vehicles.make,', '       hr.employees.name', 'FROM ops.vehicles',
      'JOIN ops.trips', '  ON ops.vehicles.vehicle_id = ops.trips.vehicle_id',
      'JOIN hr.employees', '  ON ops.trips.driver_id = hr.employees.employee_id;',
    ].join('\n'))
  })

  it('leaves out a join with no columns picked, and everything that refers to it', () => {
    const { sql, problems } = buildQuery(state({
      table: 'ops.vehicles', columns: [ref(vehicles, 'make'), ref(trips, 'trip_id'), ref(employees, 'name')], sortBy: ref(trips, 'trip_id'),
      joins: [
        { id: '1', table: 'ops.trips', from: '', to: 'vehicle_id' },
        { id: '2', table: 'hr.employees', from: ref(trips, 'driver_id'), to: 'employee_id' },
      ],
    }), fleet, 'mssql')
    expect(sql).toBe('SELECT TOP (100) make\nFROM ops.vehicles;')
    expect(problems).toHaveLength(2)
  })

  it('clears a sort that grouping makes invalid, and refuses to join a table twice', () => {
    const tidy = tidyBuilder(state({
      table: 'ops.trips', sortBy: ref(trips, 'started_at'), groupBy: ref(trips, 'status'),
      joins: [{ id: '1', table: 'ops.trips', from: ref(trips, 'trip_id'), to: 'trip_id' }],
    }), fleet)
    expect(tidy.sortBy).toBe('')
    expect(tidy.joins).toEqual([])
    expect(buildQuery(state({ table: 'ops.trips', sortBy: ref(trips, 'started_at'), groupBy: ref(trips, 'status') }), fleet, 'mssql').sql)
      .toBe('SELECT TOP (100) status, COUNT(*) AS row_count\nFROM ops.trips\nGROUP BY status\nORDER BY row_count DESC;')
  })
})

describe('filter values follow the column type', () => {
  const where = (t: SchemaTable, c: string, op: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le' | 'in' | 'contains', value: string, dialect: Dialect, tables = fleet) => {
    const { sql, problems } = buildQuery(state({ table: tableKey(t), limit: '', filters: [{ id: '1', column: ref(t, c), op, value }] }), tables, dialect)
    return { where: sql.split('\n').slice(2).join(' ').replace(/;$/, ''), problems }
  }
  const plants = table('', 'plants', [column('id', 'int', true), column('flag', 'tinyint(1)'), column('qty', 'int'), column('name', 'varchar(40)'), column('sown', 'date')])
  const books = table('catalog', 'books', [column('id', 'integer', true), column('in_print', 'boolean'), column('title', 'text'), column('added', 'timestamp without time zone')])

  it('writes booleans the database understands', () => {
    // 'true' as text is 0 to MySQL, so "equals true" used to return the rows where the flag is off.
    expect(where(plants, 'flag', 'eq', 'true', 'mysql', [plants]).where).toBe('WHERE flag = 1')
    expect(where(plants, 'flag', 'eq', 'No', 'mysql', [plants]).where).toBe('WHERE flag = 0')
    expect(where(books, 'in_print', 'eq', '1', 'postgres', [books]).where).toBe('WHERE in_print = TRUE')
    expect(where(vehicles, 'active', 'eq', 'false', 'mssql').where).toBe('WHERE active = 0')
    expect(where(plants, 'flag', 'eq', 'maybe', 'mysql', [plants])).toEqual({ where: '', problems: ['flag is a yes/no column (use true or false), and "maybe" is not'] })
  })

  it('refuses text for a number column instead of letting the database guess', () => {
    expect(where(plants, 'qty', 'in', '5, abc', 'mysql', [plants])).toEqual({ where: '', problems: ['qty is a number column, and "abc" is not'] })
    expect(where(plants, 'qty', 'in', '5, 6', 'mysql', [plants]).where).toBe('WHERE qty IN (5, 6)')
    expect(where(plants, 'name', 'eq', '5', 'mysql', [plants]).where).toBe("WHERE name = '5'")
  })

  it('treats a day on a date-and-time column as the whole day', () => {
    expect(where(trips, 'started_at', 'eq', '2026-03-04', 'mssql').where).toBe("WHERE (started_at >= '20260304' AND started_at < '20260305')")
    expect(where(trips, 'started_at', 'le', '2026-12-31', 'mssql').where).toBe("WHERE started_at < '20270101'")
    expect(where(trips, 'started_at', 'gt', '2026-03-04', 'mssql').where).toBe("WHERE started_at >= '20260305'")
    expect(where(trips, 'started_at', 'ge', '2026-03-04 08:00', 'mssql').where).toBe("WHERE started_at >= '2026-03-04T08:00:00'")
    expect(where(books, 'added', 'ne', '2026-03-04', 'postgres', [books]).where).toBe("WHERE (added < '2026-03-04' OR added >= '2026-03-05')")
    expect(where(plants, 'sown', 'eq', '2026-03-04', 'mysql', [plants]).where).toBe("WHERE sown = '2026-03-04'")
    expect(where(plants, 'sown', 'eq', 'yesterday', 'mysql', [plants]).problems).toHaveLength(1)
  })

  it('matches text the same way on every database', () => {
    expect(where(books, 'title', 'contains', 'QUOTED', 'postgres', [books]).where).toBe("WHERE title ILIKE '%QUOTED%'")
    expect(where(plants, 'name', 'contains', 'x', 'mysql', [plants]).where).toBe("WHERE name LIKE '%x%'")
  })
})

describe('names', () => {
  const quoted: [Dialect, string, string][] = [
    ['mysql', 'rank', '`rank`'], ['mysql', 'row', '`row`'], ['mysql', 'groups', '`groups`'], ['mysql', 'interval', '`interval`'], ['mysql', 'system', '`system`'],
    ['postgres', 'localtime', '"localtime"'], ['postgres', 'collation', '"collation"'], ['postgres', 'lateral', '"lateral"'],
    ['sqlite', 'key', '"key"'], ['sqlite', 'first', '"first"'], ['mssql', 'user', '[user]'], ['mssql', 'key', '[key]'],
  ]
  it.each(quoted)('%s quotes %s', (dialect, name, expected) => expect(identPart(name, dialect)).toBe(expected))

  // A word is only quoted where that database reserves it.
  const bare: [Dialect, string][] = [['mssql', 'rank'], ['postgres', 'rank'], ['postgres', 'key'], ['mysql', 'top'], ['mssql', 'limit'], ['mysql', 'status']]
  it.each(bare)('%s leaves %s bare', (dialect, name) => expect(identPart(name, dialect)).toBe(name))

  it('reads column types', () => {
    const kinds: [string, ReturnType<typeof valueKind>][] = [
      ['tinyint(1)', 'bool'], ['bit', 'bool'], ['boolean', 'bool'], ['int', 'number'], ['bigint', 'number'], ['numeric(10,2)', 'number'], ['double precision', 'number'],
      ['interval', 'other'], ['point', 'other'], ['datetime2(7)', 'datetime'], ['timestamp with time zone', 'datetime'], ['date', 'date'], ['nvarchar(80)', 'text'], ['', 'other'], ['uuid', 'other'],
    ]
    for (const [type, kind] of kinds) expect(valueKind(type), type).toBe(kind)
  })

  it('previews with the row limit where the database wants it', () => {
    expect(previewSql(trips, 'mssql')).toBe('SELECT TOP (100) *\nFROM ops.trips;')
    expect(previewSql(trips, 'postgres')).toBe('SELECT *\nFROM ops.trips\nLIMIT 100;')
  })
})

describe('runs and tabs', () => {
  const tab = { sql: 'SELECT 1;\nDELETE FROM t;', vars: {} }

  it('prepares the selected text, its line offset and whether to ask first', () => {
    expect(prepareRun(tab, { dialect: 'postgres', readOnly: false })).toMatchObject({ lineOffset: 0, errors: [], risk: 'DELETE with no WHERE affects every row' })
    expect(prepareRun(tab, { dialect: 'postgres', readOnly: false }, { text: 'SELECT 1;', line: 4 })).toMatchObject({ sql: 'SELECT 1;', lineOffset: 3, risk: null })
    // Read-only connections refuse the write outright, so there is nothing to confirm.
    expect(prepareRun(tab, { dialect: 'postgres', readOnly: true })?.risk).toBeNull()
    expect(prepareRun({ sql: '  ', vars: {} }, { dialect: 'postgres', readOnly: false })).toBeNull()
    expect(prepareRun({ sql: 'SELECT {{x}}', vars: {} }, { dialect: 'postgres', readOnly: false })?.errors).toEqual(['x is empty'])
  })

  it('counts a tab as unsaved only once its text differs from what it was opened with', () => {
    const base = { id: '1', title: 't', queryId: null, vars: {}, connectionId: 'demo' }
    expect(isDirty({ ...base, sql: 'SELECT 1', openedSql: 'SELECT 1' }, [])).toBe(false)
    expect(isDirty({ ...base, sql: 'SELECT 2', openedSql: 'SELECT 1' }, [])).toBe(true)
    expect(isDirty({ ...base, sql: 'SELECT 1' }, [])).toBe(true)
    expect(isDirty({ ...base, sql: '' }, [])).toBe(false)
    const saved = { id: 'q', name: 'q', sql: 'SELECT 1', folderId: null, tags: [], pinned: false, updatedAt: 0 }
    expect(isDirty({ ...base, queryId: 'q', sql: 'SELECT 1' }, [saved])).toBe(false)
    expect(isDirty({ ...base, queryId: 'q', sql: 'SELECT 2' }, [saved])).toBe(true)
  })
})
