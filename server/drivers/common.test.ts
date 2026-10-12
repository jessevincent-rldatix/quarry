import { describe, expect, it } from 'vitest'
import type { ResultSet } from '../../shared/types.ts'
import { buildSchema, CANCELLED, emptyResult, markCancelled, MAX_BINARY_BYTES, overflowAllowance, RowCollector, STOPPED, toCell, ValueKinds } from './common.ts'

const newSet = (): ResultSet => ({ columns: [{ name: 'n', type: '' }], rows: [], truncated: false })

describe('RowCollector', () => {
  it('keeps rows up to the limit and leaves the set unmarked', () => {
    const result = emptyResult()
    const collector = new RowCollector(result, 3)
    const set = newSet()
    expect([1, 2, 3].map((n) => collector.push(set, () => [n]))).toEqual(['kept', 'kept', 'kept'])
    expect(set.rows).toEqual([[1], [2], [3]])
    expect(set.truncated).toBe(false)
    expect(result.messages).toEqual([])
  })

  it('drops rows past the limit, marks the set, and does not convert them', () => {
    const collector = new RowCollector(emptyResult(), 2)
    const set = newSet()
    let converted = 0
    const pushed = [1, 2, 3, 4].map((n) => collector.push(set, () => { converted++; return [n] }))
    expect(pushed).toEqual(['kept', 'kept', 'dropped', 'dropped'])
    expect(set.rows).toHaveLength(2)
    expect(set.truncated).toBe(true)
    expect(converted).toBe(2)
  })

  it('says stop once, on the first row past the allowance, and adds the message', () => {
    const result = emptyResult()
    const maxRows = 5
    const collector = new RowCollector(result, maxRows)
    const set = newSet()
    for (let n = 0; n < maxRows; n++) collector.push(set, () => [n])
    const allowance = overflowAllowance(maxRows)
    for (let n = 0; n < allowance; n++) expect(collector.push(set, () => [n])).toBe('dropped')
    expect(result.messages).toEqual([])
    expect(collector.push(set, () => [0])).toBe('stop')
    expect(result.messages).toEqual([STOPPED])
    // Rows already on their way keep arriving after the query is cancelled.
    expect(collector.push(set, () => [0])).toBe('dropped')
    expect(result.messages).toEqual([STOPPED])
    expect(set.rows).toHaveLength(maxRows)
  })

  it('applies the limit to each set and counts thrown-away rows across the run', () => {
    const maxRows = 30000
    const collector = new RowCollector(emptyResult(), maxRows)
    const first = newSet()
    const second = newSet()
    for (let n = 0; n < maxRows; n++) { collector.push(first, () => [n]); collector.push(second, () => [n]) }
    expect(first.rows).toHaveLength(maxRows)
    expect(second.rows).toHaveLength(maxRows)
    const allowance = overflowAllowance(maxRows)
    for (let n = 0; n < allowance / 2; n++) { collector.push(first, () => [n]); collector.push(second, () => [n]) }
    expect(collector.push(first, () => [0])).toBe('stop')
  })

  it('allows at least 100,000 extra rows, and four times a large limit', () => {
    expect(overflowAllowance(10)).toBe(100000)
    expect(overflowAllowance(50000)).toBe(200000)
  })
})

describe('markCancelled', () => {
  it('sets stopped and adds the message once', () => {
    const result = emptyResult()
    markCancelled(result)
    markCancelled(result)
    expect(result.stopped).toBe(true)
    expect(result.messages).toEqual([CANCELLED])
  })
})

describe('toCell', () => {
  it('passes text, booleans and ordinary numbers through', () => {
    expect(toCell('a')).toBe('a')
    expect(toCell(false)).toBe(false)
    expect(toCell(1.5)).toBe(1.5)
  })

  it('turns null and undefined into null', () => {
    expect(toCell(null)).toBeNull()
    expect(toCell(undefined)).toBeNull()
  })

  it('writes numbers that are not finite as text', () => {
    expect(toCell(Infinity)).toBe('Infinity')
    expect(toCell(NaN)).toBe('NaN')
  })

  it('keeps big integers exact: a number within 2^53, text beyond', () => {
    expect(toCell(42n)).toBe(42)
    expect(toCell(9007199254740991n)).toBe(9007199254740991)
    expect(toCell(9007199254740993n)).toBe('9007199254740993')
    expect(toCell(-9223372036854775808n)).toBe('-9223372036854775808')
  })

  it('writes dates as ISO text and an invalid date as null', () => {
    expect(toCell(new Date('2024-03-05T06:07:08.009Z'))).toBe('2024-03-05T06:07:08.009Z')
    expect(toCell(new Date('nope'))).toBeNull()
  })

  it('writes bytes as hex and cuts long values short', () => {
    expect(toCell(Buffer.from([1, 171]))).toBe('0x01ab')
    expect(toCell(new Uint8Array([255]))).toBe('0xff')
    const long = toCell(Buffer.alloc(MAX_BINARY_BYTES + 10, 1)) as string
    expect(long.startsWith('0x0101')).toBe(true)
    expect(long).toContain(`(${MAX_BINARY_BYTES + 10} bytes, first ${MAX_BINARY_BYTES} shown)`)
  })

  it('writes anything else as JSON', () => {
    expect(toCell({ a: [1, 2] })).toBe('{"a":[1,2]}')
  })
})

describe('ValueKinds', () => {
  const kindOf = (...values: unknown[]) => {
    const kinds = new ValueKinds()
    for (const value of values) kinds.add(value)
    return kinds.kind()
  }

  it('has no answer for no rows or only NULLs', () => {
    expect(kindOf()).toBeUndefined()
    expect(kindOf(null, undefined)).toBeUndefined()
  })

  it('calls whole numbers integer, including ones too big for a JavaScript number', () => {
    expect(kindOf(1n, 2n, null)).toBe('integer')
    expect(kindOf(9223372036854775807n)).toBe('integer')
    expect(kindOf(3)).toBe('integer')
  })

  it('calls a column with any fraction float', () => {
    expect(kindOf(1.5)).toBe('float')
    expect(kindOf(1n, 2.5)).toBe('float')
  })

  it('recognises bytes, dates written as text, and plain text', () => {
    expect(kindOf(new Uint8Array([1]))).toBe('binary')
    expect(kindOf('2024-01-02', '2024-01-02 03:04:05', '2024-01-02T03:04:05.123Z')).toBe('date')
    expect(kindOf('2024-01-02', 'soon')).toBe('text')
    expect(kindOf('abc')).toBe('text')
  })

  it('falls back to text when values disagree', () => {
    expect(kindOf(1n, 'a')).toBe('text')
    expect(kindOf(1.5, new Uint8Array([1]))).toBe('text')
  })
})

describe('buildSchema', () => {
  it('groups columns into tables in the order given', () => {
    const tables = buildSchema([
      ['dbo', 'truck', 'BASE TABLE', 'id', 'int', 'NO', 1],
      ['dbo', 'truck', 'BASE TABLE', 'plate', 'varchar(10)', 'YES', 0],
      ['dbo', 'active_trucks', 'VIEW', 'id', 'int', 'NO', 0],
    ])
    expect(tables.map((t) => [t.schema, t.name, t.kind])).toEqual([['dbo', 'truck', 'table'], ['dbo', 'active_trucks', 'view']])
    expect(tables[0].columns).toEqual([
      { name: 'id', type: 'int', nullable: false, pk: true },
      { name: 'plate', type: 'varchar(10)', nullable: true, pk: false },
    ])
  })

  it('reads nullable and key flags in each form the databases use', () => {
    const [table] = buildSchema([
      ['', 't', 'table', 'a', 'int', true, true],
      ['', 't', 'table', 'b', 'int', 't', 't'],
      ['', 't', 'table', 'c', 'int', 1, 1],
      ['', 't', 'table', 'd', 'int', 'YES', '1'],
      ['', 't', 'table', 'e', 'int', false, false],
      ['', 't', 'table', 'f', 'int', 'NO', 0],
      ['', 't', 'table', 'g', null, 'f', 'f'],
    ])
    expect(table.columns.map((c) => c.nullable)).toEqual([true, true, true, true, false, false, false])
    expect(table.columns.map((c) => c.pk)).toEqual([true, true, true, true, false, false, false])
    expect(table.columns[6].type).toBe('')
  })

  it('keeps tables with the same name in different schemas apart', () => {
    const tables = buildSchema([
      ['a', 't', 'table', 'x', 'int', 'NO', 0],
      ['b', 't', 'table', 'y', 'int', 'NO', 0],
    ])
    expect(tables).toHaveLength(2)
    expect(tables[1].columns[0].name).toBe('y')
  })

  it('attaches foreign keys to their table and ignores ones for tables it does not know', () => {
    const tables = buildSchema(
      [
        ['dbo', 'trip', 'table', 'truck_id', 'int', 'NO', 0],
        ['dbo', 'truck', 'table', 'id', 'int', 'NO', 1],
      ],
      [
        ['dbo', 'trip', 'truck_id', 'dbo', 'truck', 'id'],
        ['dbo', 'gone', 'x', 'dbo', 'truck', 'id'],
      ],
    )
    expect(tables[0].foreignKeys).toEqual([{ column: 'truck_id', refSchema: 'dbo', refTable: 'truck', refColumn: 'id' }])
    expect(tables[1].foreignKeys).toEqual([])
  })

  it('treats a missing schema as blank (SQLite)', () => {
    const tables = buildSchema([[null, 't', 'table', 'x', 'INTEGER', 1, 1]], [[null, 't', 'x', null, 'u', 'id']])
    expect(tables[0].schema).toBe('')
    expect(tables[0].foreignKeys).toEqual([{ column: 'x', refSchema: '', refTable: 'u', refColumn: 'id' }])
  })
})
