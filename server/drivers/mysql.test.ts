import { describe, expect, it } from 'vitest'
import { mysqlBit, mysqlColumn } from './mysql.ts'

// Wire type codes, character sets and flags as MySQL sends them.
const UTF8 = 255
const BINARY = 63
const column = (columnType: number, characterSet = BINARY, flags = 0) => mysqlColumn({ name: 'c', columnType, characterSet, flags })

describe('mysqlColumn', () => {
  it('labels text and binary twins by the character set', () => {
    expect(column(253, UTF8)).toEqual({ name: 'c', type: 'varchar', kind: 'text' })
    expect(column(253, BINARY)).toEqual({ name: 'c', type: 'varbinary', kind: 'binary' })
    expect(column(252, UTF8)).toEqual({ name: 'c', type: 'text', kind: 'text' })
    expect(column(252, BINARY)).toEqual({ name: 'c', type: 'blob', kind: 'binary' })
    expect(column(254, UTF8)).toEqual({ name: 'c', type: 'char', kind: 'text' })
    expect(column(254, BINARY)).toEqual({ name: 'c', type: 'binary', kind: 'binary' })
    expect(column(251, BINARY).type).toBe('longblob')
    expect(column(251, UTF8).type).toBe('longtext')
  })

  it('does not mistake numbers, dates or JSON for binary, though they use the binary character set', () => {
    expect(column(3)).toEqual({ name: 'c', type: 'int', numeric: true, kind: 'integer' })
    expect(column(12)).toEqual({ name: 'c', type: 'datetime', kind: 'date' })
    expect(column(245)).toEqual({ name: 'c', type: 'json', kind: 'json' })
  })

  it('marks every number type numeric with its kind', () => {
    expect([1, 2, 3, 8, 9, 13].map((code) => column(code).kind)).toEqual(Array(6).fill('integer'))
    expect([0, 246].map((code) => column(code))).toEqual(Array(2).fill({ name: 'c', type: 'decimal', numeric: true, kind: 'decimal' }))
    expect([4, 5].map((code) => column(code).kind)).toEqual(['float', 'float'])
    expect(column(8)).toEqual({ name: 'c', type: 'bigint', numeric: true, kind: 'integer' })
  })

  it('labels bit as a number', () => {
    expect(column(16)).toEqual({ name: 'c', type: 'bit', numeric: true, kind: 'integer' })
  })

  it('labels dates and times', () => {
    expect([7, 10, 11, 12].map((code) => [column(code).type, column(code).kind])).toEqual([['timestamp', 'date'], ['date', 'date'], ['time', 'date'], ['datetime', 'date']])
  })

  it('labels enum and set from their flags', () => {
    expect(column(254, UTF8, 256)).toEqual({ name: 'c', type: 'enum', kind: 'text' })
    expect(column(254, UTF8, 2048)).toEqual({ name: 'c', type: 'set', kind: 'text' })
  })

  it('reads the type code from `type` when `columnType` is absent', () => {
    expect(mysqlColumn({ name: 'c', type: 3 })).toEqual({ name: 'c', type: 'int', numeric: true, kind: 'integer' })
  })

  it('leaves an unknown type blank with no kind', () => {
    expect(column(200)).toEqual({ name: 'c', type: '' })
    expect(mysqlColumn({ name: 'c' })).toEqual({ name: 'c', type: '' })
  })
})

describe('mysqlBit', () => {
  it('shows bit(1) as 0 or 1', () => {
    expect(mysqlBit(Buffer.from([1]))).toBe(1)
    expect(mysqlBit(Buffer.from([0]))).toBe(0)
  })

  it('shows wider bit columns as the number the bits spell', () => {
    expect(mysqlBit(Buffer.from([5]))).toBe(5)
    expect(mysqlBit(Buffer.from([1, 0]))).toBe(256)
    expect(mysqlBit(Buffer.from([0, 0, 0, 0, 0, 0, 0, 1]))).toBe(1)
  })

  it('keeps a 64-bit value exact as text', () => {
    expect(mysqlBit(Buffer.alloc(8, 255))).toBe('18446744073709551615')
  })

  it('passes null through', () => {
    expect(mysqlBit(null)).toBeNull()
  })
})
