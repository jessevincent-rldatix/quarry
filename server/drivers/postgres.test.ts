import { describe, expect, it } from 'vitest'
import { PG_TYPES, pgColumn, pgTypeFromCatalogue, type PgType } from './postgres.ts'

describe('pgColumn', () => {
  it('names the types that used to be blank', () => {
    const names = (oids: number[]) => oids.map((oid) => pgColumn('c', oid).type)
    expect(names([1560, 1562])).toEqual(['bit', 'varbit'])
    expect(names([869, 650, 829])).toEqual(['inet', 'cidr', 'macaddr'])
    expect(names([600, 603, 718])).toEqual(['point', 'box', 'circle'])
    expect(names([3904, 3906, 3908, 3910, 3912, 3926])).toEqual(['int4range', 'numrange', 'tsrange', 'tstzrange', 'daterange', 'int8range'])
    expect(names([3614, 4451])).toEqual(['tsvector', 'int4multirange'])
  })

  it('marks whole numbers, including int8 that arrives as text', () => {
    for (const oid of [20, 21, 23, 26]) expect(pgColumn('c', oid)).toMatchObject({ numeric: true, kind: 'integer' })
    expect(pgColumn('n', 20)).toEqual({ name: 'n', type: 'int8', numeric: true, kind: 'integer' })
  })

  it('tells decimals and floats apart', () => {
    expect(pgColumn('c', 1700)).toEqual({ name: 'c', type: 'numeric', numeric: true, kind: 'decimal' })
    expect(pgColumn('c', 700)).toMatchObject({ type: 'float4', numeric: true, kind: 'float' })
    expect(pgColumn('c', 701)).toMatchObject({ type: 'float8', numeric: true, kind: 'float' })
  })

  it('gives booleans, dates, JSON and bytes their kinds', () => {
    expect(pgColumn('c', 16)).toEqual({ name: 'c', type: 'bool', numeric: false, kind: 'bool' })
    expect([1082, 1083, 1114, 1184, 1266].map((oid) => pgColumn('c', oid).kind)).toEqual(Array(5).fill('date'))
    expect([114, 3802].map((oid) => pgColumn('c', oid).kind)).toEqual(['json', 'json'])
    expect(pgColumn('c', 17)).toMatchObject({ type: 'bytea', kind: 'binary' })
  })

  it('treats everything else it knows as text, money and arrays included', () => {
    expect(pgColumn('c', 25)).toEqual({ name: 'c', type: 'text', numeric: false, kind: 'text' })
    expect(pgColumn('c', 790)).toMatchObject({ type: 'money', numeric: false, kind: 'text' })
    expect(pgColumn('c', 1007)).toMatchObject({ type: 'int4[]', numeric: false, kind: 'text' })
    expect(pgColumn('c', 1186)).toMatchObject({ type: 'interval', kind: 'text' })
    expect(pgColumn('c', 869)).toMatchObject({ type: 'inet', kind: 'text' })
  })

  it('leaves a type it does not know blank with no kind', () => {
    expect(pgColumn('c', 99999)).toEqual({ name: 'c', type: '', numeric: false })
  })

  it('uses what was looked up from the server for a type it does not know', () => {
    const looked = new Map<number, PgType>([[99999, { name: 'mood', kind: 'text' }], [99998, { name: 'uint8', kind: 'decimal' }]])
    expect(pgColumn('c', 99999, looked)).toEqual({ name: 'c', type: 'mood', numeric: false, kind: 'text' })
    expect(pgColumn('c', 99998, looked)).toEqual({ name: 'c', type: 'uint8', numeric: true, kind: 'decimal' })
  })

  it('prefers its own table over a looked-up name', () => {
    expect(pgColumn('c', 23, new Map([[23, { name: 'other', kind: 'text' }]]))).toMatchObject({ type: 'int4', kind: 'integer' })
  })

  it('has a name for every type it has a kind for', () => {
    for (const oid of [16, 17, 20, 21, 23, 26, 114, 700, 701, 1082, 1083, 1114, 1184, 1266, 1700, 3802]) expect(PG_TYPES[oid]).toBeTruthy()
  })
})

describe('pgTypeFromCatalogue', () => {
  it('reads the kind from the type category', () => {
    expect(pgTypeFromCatalogue('mood', 'E')).toEqual({ name: 'mood', kind: 'text' })
    expect(pgTypeFromCatalogue('uint8', 'N')).toEqual({ name: 'uint8', kind: 'decimal' })
    expect(pgTypeFromCatalogue('flag', 'B')).toEqual({ name: 'flag', kind: 'bool' })
    expect(pgTypeFromCatalogue('stamp', 'D')).toEqual({ name: 'stamp', kind: 'date' })
    expect(pgTypeFromCatalogue('mood[]', 'A')).toEqual({ name: 'mood[]', kind: 'text' })
  })
})
