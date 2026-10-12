import { describe, expect, it } from 'vitest'
import { mssqlCell, mssqlKind, roundedDecimal } from './mssql.ts'

// The values below are what the driver hands over: SQL Server numbers already read into JavaScript numbers.
const real = (n: number) => Math.fround(n)

describe('mssqlCell: real', () => {
  it('shows what the database holds, not the digits added by widening', () => {
    expect(real(3.14)).toBe(3.140000104904175)
    expect(mssqlCell(real(3.14), 'real', undefined)).toBe(3.14)
    expect(mssqlCell(real(0.000001), 'real', undefined)).toBe(0.000001)
    expect(mssqlCell(real(1e20), 'real', undefined)).toBe(1e20)
    expect(mssqlCell(real(-2.5), 'real', undefined)).toBe(-2.5)
    expect(mssqlCell(real(16777216), 'real', undefined)).toBe(16777216)
  })

  it('gives back the same real when read again', () => {
    for (const n of [3.14, 0.1, 123456.789, 1 / 3, 3.4e38, 1.2e-38]) {
      const shown = mssqlCell(real(n), 'real', undefined) as number
      expect(Math.fround(shown)).toBe(real(n))
      expect(String(shown).replace(/[-.]|e.*$/g, '').replace(/^0+/, '').length).toBeLessThanOrEqual(9)
    }
  })

  it('leaves float alone', () => {
    expect(mssqlCell(3.140000104904175, 'float', undefined)).toBe(3.140000104904175)
    expect(mssqlCell(0.1, 'float', undefined)).toBe(0.1)
  })
})

describe('mssqlCell: money', () => {
  it('keeps at least two decimal places and at most four', () => {
    expect(mssqlCell(12.5, 'money', 4)).toBe('12.50')
    expect(mssqlCell(1.5, 'smallmoney', 4)).toBe('1.50')
    expect(mssqlCell(1.2345, 'money', 4)).toBe('1.2345')
    expect(mssqlCell(-0.125, 'money', undefined)).toBe('-0.125')
    expect(mssqlCell(0, 'money', 4)).toBe('0.00')
  })

  it('warns about, and does not invent digits for, money too long to read exactly', () => {
    // 922337203685477.5807 as the driver reads it.
    const largest = 922337203685477.5807
    expect(roundedDecimal(largest, 'money', 4)).toBe(true)
    expect(mssqlCell(largest, 'money', 4)).toBe('922337203685478')
    expect(roundedDecimal(-largest, 'money', undefined)).toBe(true)
    expect(mssqlCell(-largest, 'money', 4)).toBe('-922337203685478')
  })

  it('does not warn for money of 15 digits or fewer', () => {
    expect(roundedDecimal(99999999999.9999, 'money', 4)).toBe(false)
    expect(mssqlCell(99999999999.9999, 'money', 4)).toBe('99999999999.9999')
    expect(roundedDecimal(214748.3647, 'smallmoney', 4)).toBe(false)
    expect(roundedDecimal(100000000000, 'money', 4)).toBe(true)
  })
})

describe('mssqlCell: decimal and numeric', () => {
  it('keeps the declared scale', () => {
    expect(mssqlCell(123.45, 'decimal', 2)).toBe('123.45')
    expect(mssqlCell(5, 'numeric', 3)).toBe('5.000')
    expect(mssqlCell(-0.5, 'decimal', 3)).toBe('-0.500')
    expect(mssqlCell(7, 'decimal', 0)).toBe('7')
    expect(mssqlCell(7, 'decimal', undefined)).toBe('7')
  })

  it('shows a small value in a wide scale exactly, with no warning', () => {
    expect(roundedDecimal(1e-38, 'decimal', 38)).toBe(false)
    expect(mssqlCell(1e-38, 'decimal', 38)).toBe(`0.${'0'.repeat(37)}1`)
    expect(roundedDecimal(0.000000000000123, 'decimal', 15)).toBe(false)
    expect(mssqlCell(0.000000000000123, 'decimal', 15)).toBe('0.000000000000123')
  })

  it('warns for decimal(38,38) 0.1 and shows only the digits that were read', () => {
    // 0.1 in a decimal(38,38) column as the driver reads it.
    const read = 0.09999999999999999167
    expect(roundedDecimal(read, 'decimal', 38)).toBe(true)
    expect(mssqlCell(read, 'decimal', 38)).toBe('0.100000000000000')
  })

  it('warns whenever the stored digits pass 15, whatever the scale', () => {
    expect(roundedDecimal(0.5, 'decimal', 20)).toBe(true)
    expect(roundedDecimal(1234567890123.45, 'decimal', 2)).toBe(false)
    expect(roundedDecimal(12345678901234.56, 'decimal', 2)).toBe(true)
    expect(roundedDecimal(999999999999999, 'numeric', 0)).toBe(false)
    expect(roundedDecimal(1000000000000000, 'numeric', 0)).toBe(true)
  })

  it('rounds a long value to 15 digits rather than printing digits it never had', () => {
    expect(mssqlCell(12345678901234.56, 'decimal', 2)).toBe('12345678901234.6')
    expect(mssqlCell(-1.2345678901234567, 'decimal', 20)).toBe('-1.23456789012346')
    expect(mssqlCell(0.000012345678901234567, 'decimal', 30)).toBe('0.0000123456789012346')
  })

  it('writes very large values as whole numbers in plain digits', () => {
    expect(mssqlCell(12345678901234567.89, 'decimal', 2)).toBe('12345678901234568')
    expect(mssqlCell(1e25, 'decimal', 0)).toBe(`1${'0'.repeat(25)}`)
    expect(mssqlCell(-1.5e30, 'numeric', 2)).toBe(`-15${'0'.repeat(29)}`)
  })

  it('does not treat other types as decimals', () => {
    expect(roundedDecimal(1e20, 'float', undefined)).toBe(false)
    expect(roundedDecimal('12345678901234567890', 'decimal', 0)).toBe(false)
    expect(mssqlCell(42, 'int', undefined)).toBe(42)
    expect(mssqlCell('9007199254740993', 'bigint', undefined)).toBe('9007199254740993')
  })
})

describe('mssqlCell: other values', () => {
  it('passes null through', () => {
    expect(mssqlCell(null, 'money', 4)).toBeNull()
    expect(mssqlCell(undefined, 'real', undefined)).toBeNull()
  })

  it('prints dates and times the way the column type would', () => {
    const at = new Date('2024-03-05T06:07:08.120Z')
    expect(mssqlCell(at, 'date', undefined)).toBe('2024-03-05')
    expect(mssqlCell(at, 'datetime', undefined)).toBe('2024-03-05 06:07:08.12')
    expect(mssqlCell(at, 'time', 7)).toBe('06:07:08.12')
    expect(mssqlCell(at, 'datetimeoffset', 7)).toBe('2024-03-05 06:07:08.12 +00:00')
    expect(mssqlCell(new Date('2024-03-05T06:07:00Z'), 'datetime2', 7)).toBe('2024-03-05 06:07:00')
  })

  it('adds the part of a datetime2 finer than a millisecond', () => {
    const at = Object.assign(new Date('2024-03-05T06:07:08.123Z'), { nanosecondsDelta: 0.0004567 })
    expect(mssqlCell(at, 'datetime2', 7)).toBe('2024-03-05 06:07:08.1234567')
  })

  it('writes bytes as hex', () => {
    expect(mssqlCell(Buffer.from([1, 2]), 'varbinary', undefined)).toBe('0x0102')
  })
})

describe('mssqlKind', () => {
  it('maps each family of types', () => {
    expect(['int', 'bigint', 'smallint', 'tinyint'].map(mssqlKind)).toEqual(['integer', 'integer', 'integer', 'integer'])
    expect(['decimal', 'numeric', 'money', 'smallmoney'].map(mssqlKind)).toEqual(['decimal', 'decimal', 'decimal', 'decimal'])
    expect(['float', 'real'].map(mssqlKind)).toEqual(['float', 'float'])
    expect(mssqlKind('bit')).toBe('bool')
    expect(['date', 'time', 'datetime', 'datetime2', 'smalldatetime', 'datetimeoffset'].map(mssqlKind)).toEqual(Array(6).fill('date'))
    expect(['binary', 'varbinary', 'image'].map(mssqlKind)).toEqual(['binary', 'binary', 'binary'])
    expect(['varchar', 'nvarchar', 'char', 'text', 'xml', 'uniqueidentifier'].map(mssqlKind)).toEqual(Array(6).fill('text'))
  })

  it('ignores case and a length or precision', () => {
    expect(mssqlKind('Decimal(18, 2)')).toBe('decimal')
    expect(mssqlKind('VARBINARY(max)')).toBe('binary')
  })

  it('has no answer for a blank type', () => {
    expect(mssqlKind('')).toBeUndefined()
  })
})
