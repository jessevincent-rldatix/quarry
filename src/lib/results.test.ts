import { describe, expect, it } from 'vitest'
import type { Cell, ResultColumn, ResultSet } from '@shared/types'
import { compareCells, filterSortRows, isFiniteNumber, numericColumns, rangeCellCount, selectionRange, sumRange } from './results'

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)
const column = (cells: Cell[]) => cells.map((cell) => [cell])
const sorted = (cells: Cell[], numeric: boolean, desc = false) =>
  filterSortRows(column(cells), '', { column: 0, desc }, [numeric]).map((row) => row[0])
const resultSet = (columns: ResultColumn[], rows: Cell[][]): ResultSet => ({ columns, rows, truncated: false })

describe('compareCells', () => {
  it.each<[string, Cell, Cell, boolean, number]>([
    ['integers above 2^53 that differ in the last digit', '9007199254740993', '9007199254740992', true, 1],
    ['the same large integer', '9007199254740993', '9007199254740993', true, 0],
    ['large negative integers', '-9007199254740993', '-9007199254740992', true, -1],
    ['a large integer against a number', '9007199254740993', 9007199254740992, true, 1],
    ['a longer integer is larger', '10000000000000000000', '9999999999999999999', true, 1],
    ['long decimals that differ in the last place', '0.1234567890123456789', '0.1234567890123456788', true, 1],
    ['decimals of different lengths', '12.5', '12.50', true, 0],
    ['decimals against integers', '9.99', '10', true, -1],
    ['a decimal against a number', '12.50', 12.5, true, 0],
    ['negative against positive', '-0.5', '0.25', true, -1],
    ['negative zero is zero', '-0.00', '0', true, 0],
    ['leading zeros', '007', '7', true, 0],
    ['exponent form', '1e3', '999.9', true, 1],
    ['numbers in a numeric column', 9, 10, true, -1],
    ['NaN above every number', 'NaN', '99999999999999999999', true, 1],
    ['NaN above Infinity', 'NaN', 'Infinity', true, 1],
    ['NaN equals NaN', 'NaN', 'NaN', true, 0],
    ['Infinity above every number', 'Infinity', '1e300', true, 1],
    ['-Infinity below every number', '-Infinity', '-99999999999999999999', true, -1],
    ['text is case-insensitive: a before B', 'a', 'B', false, -1],
    ['text is case-insensitive: Z after a', 'Z', 'a', false, 1],
    ['digits inside text count as numbers', 'file2', 'file10', false, -1],
    ['two numbers in a column not marked numeric', 9, 10, false, -1],
    ['NULL after a value', null, 'a', false, 1],
    ['a value before NULL', 'a', null, false, -1],
    ['NULL equals NULL', null, null, true, 0],
  ])('%s', (_name, a, b, numeric, expected) => {
    expect(sign(compareCells(a, b, numeric, false))).toBe(expected)
    expect(sign(compareCells(b, a, numeric, false))).toBe(-expected || 0)
  })

  it.each<[Cell, Cell]>([[null, 1], [null, 'a'], [null, 'NaN']])('keeps NULL last when descending: %s against %s', (a, b) => {
    expect(compareCells(a, b, true, true)).toBe(1)
    expect(compareCells(b, a, true, true)).toBe(-1)
  })

  it('reverses the order when descending', () => {
    expect(sign(compareCells('9007199254740993', '9007199254740992', true, true))).toBe(-1)
    expect(sign(compareCells('a', 'B', false, true))).toBe(1)
  })
})

describe('filterSortRows', () => {
  it.each<[string, Cell[], boolean, boolean, Cell[]]>([
    ['large integers in exact order', ['9007199254740993', '9007199254740992', '9007199254740994'], true, false,
      ['9007199254740992', '9007199254740993', '9007199254740994']],
    ['a column with one integer sent as text', [10, 9, '9007199254740993', 100], true, false, [9, 10, 100, '9007199254740993']],
    ['decimal text', ['12.50', '2.5', '-3', '100'], true, false, ['-3', '2.5', '12.50', '100']],
    ['NaN and Infinity, ascending, as Postgres does', ['NaN', '1', 'Infinity', '-Infinity', '2', null], true, false,
      ['-Infinity', '1', '2', 'Infinity', 'NaN', null]],
    ['NaN and Infinity, descending, NULL still last', ['NaN', '1', 'Infinity', '-Infinity', '2', null], true, true,
      ['NaN', 'Infinity', '2', '1', '-Infinity', null]],
    ['NULLs last, ascending', [null, 2, null, 1], true, false, [1, 2, null, null]],
    ['NULLs last, descending', [null, 2, null, 1], true, true, [2, 1, null, null]],
    ['text without regard to case', ['banana', 'Zebra', 'apple', 'Cherry'], false, false, ['apple', 'banana', 'Cherry', 'Zebra']],
    ['text descending, NULL last', ['banana', null, 'Zebra', 'apple'], false, true, ['Zebra', 'banana', 'apple', null]],
    ['stray text in a numeric column goes after the numbers', ['n/a', '2', '1'], true, false, ['1', '2', 'n/a']],
  ])('sorts %s', (_name, cells, numeric, desc, expected) => {
    expect(sorted(cells, numeric, desc)).toEqual(expected)
  })

  const rows: Cell[][] = [[1, 'Alpha'], [2, null], [3, 'beta'], [10, 'ALPHABET']]

  it.each<[string, string, Cell[]]>([
    ['no filter', '', [1, 2, 3, 10]],
    ['only spaces', '   ', [1, 2, 3, 10]],
    ['any case', 'alpha', [1, 10]],
    ['surrounding spaces ignored', '  BETA ', [3]],
    ['numbers match as text', '1', [1, 10]],
    ['NULL is not the text null', 'null', []],
    ['no match', 'zzz', []],
  ])('filters with %s', (_name, filter, ids) => {
    expect(filterSortRows(rows, filter, null, [true, false]).map((row) => row[0])).toEqual(ids)
  })

  it('filters, then sorts what is left', () => {
    expect(filterSortRows(rows, 'alpha', { column: 0, desc: true }, [true, false]).map((row) => row[0])).toEqual([10, 1])
  })

  it('returns the same array when there is nothing to do, and never reorders the input', () => {
    expect(filterSortRows(rows, '', null, [true, false])).toBe(rows)
    const before = rows.map((row) => row[0])
    filterSortRows(rows, '', { column: 0, desc: true }, [true, false])
    filterSortRows(rows, '', { column: 1, desc: false }, [true, false])
    expect(rows.map((row) => row[0])).toEqual(before)
  })

  it('keeps rows that compare equal in their original order', () => {
    const ties: Cell[][] = [['a', 1], ['A', 2], ['a', 3]]
    expect(filterSortRows(ties, '', { column: 0, desc: false }, [false, true]).map((row) => row[1])).toEqual([1, 2, 3])
  })
})

describe('numericColumns', () => {
  it.each<[string, ResultColumn, Cell[], boolean]>([
    ['kind integer', { name: 'c', type: '', kind: 'integer' }, ['x'], true],
    ['kind decimal', { name: 'c', type: '', kind: 'decimal' }, [], true],
    ['kind float', { name: 'c', type: '', kind: 'float' }, [], true],
    ['kind text, even when it holds numbers', { name: 'c', type: '', kind: 'text' }, [1, 2], false],
    ['kind date', { name: 'c', type: '', kind: 'date' }, [], false],
    ['kind wins over the numeric flag', { name: 'c', type: '', kind: 'text', numeric: true }, [1], false],
    ['numeric flag set', { name: 'c', type: '', numeric: true }, ['12.50'], true],
    ['numeric flag cleared', { name: 'c', type: '', numeric: false }, [1, 2], false],
    ['no word from the driver: all numbers', { name: 'c', type: '' }, [1, null, 2.5], true],
    ['no word from the driver: one integer too large for a number', { name: 'c', type: '' }, [9, 10, '9007199254740993'], true],
    ['no word from the driver: a large negative integer', { name: 'c', type: '' }, [9, '-9007199254740993'], true],
    ['no word from the driver: short digit text is text', { name: 'c', type: '' }, [1, '12'], false],
    ['no word from the driver: digit text with leading zeros is text', { name: 'c', type: '' }, ['00123456789012345678'], false],
    ['no word from the driver: words', { name: 'c', type: '' }, [1, 'abc'], false],
    ['no word from the driver: only NULLs', { name: 'c', type: '' }, [null, null], false],
    ['no word from the driver: no rows', { name: 'c', type: '' }, [], false],
  ])('%s', (_name, col, cells, expected) => {
    expect(numericColumns(resultSet([col], column(cells)))).toEqual([expected])
  })
})

describe('selection', () => {
  it.each<[string, [number, number], [number, number], { top: number; bottom: number; left: number; right: number }, number]>([
    ['one cell', [2, 1], [2, 1], { top: 2, bottom: 2, left: 1, right: 1 }, 1],
    ['dragged down and right', [1, 0], [3, 2], { top: 1, bottom: 3, left: 0, right: 2 }, 9],
    ['dragged up and left', [3, 2], [1, 0], { top: 1, bottom: 3, left: 0, right: 2 }, 9],
    ['past the edges is pulled back in', [-5, -5], [99, 99], { top: 0, bottom: 4, left: 0, right: 2 }, 15],
  ])('range of %s', (_name, anchor, focus, expected, count) => {
    const range = selectionRange({ anchor: { row: anchor[0], column: anchor[1] }, focus: { row: focus[0], column: focus[1] } }, 5, 3)
    expect(range).toEqual(expected)
    expect(rangeCellCount(range)).toBe(count)
  })

  it.each<[string, Cell[], boolean, string | null]>([
    ['integers', [1, 2, 3], true, '6'],
    ['decimals, without float error', [0.1, 0.2], true, '0.3'],
    ['decimal text keeps its places', ['12.50', '13.00'], true, '25.50'],
    ['large integers keep every digit', ['9007199254740993', '9007199254740993'], true, '18014398509481986'],
    ['mixed signs', ['-1.5', 1, '0.25'], true, '-0.25'],
    ['a total between -1 and 0', ['-0.75', '0.5'], true, '-0.25'],
    ['exponent form', ['1e3', 1], true, '1001'],
    ['NULLs are passed over', [1, null, 2], true, '3'],
    ['only NULLs', [null, null], true, null],
    ['NaN gives no sum', ['1', 'NaN'], true, null],
    ['Infinity gives no sum', [1, 'Infinity'], true, null],
    ['a column that is not numeric gives no sum', ['1', '2'], false, null],
  ])('sum of %s', (_name, cells, numeric, expected) => {
    expect(sumRange(column(cells), [numeric], { top: 0, bottom: cells.length - 1, left: 0, right: 0 })).toBe(expected)
  })

  it('adds up only the cells inside the range', () => {
    const rows: Cell[][] = [[1, 10, 'a'], [2, 20, 'b'], [3, 30, 'c']]
    expect(sumRange(rows, [true, true, false], { top: 1, bottom: 2, left: 0, right: 1 })).toBe('55')
    expect(sumRange(rows, [true, true, false], { top: 0, bottom: 2, left: 1, right: 2 })).toBeNull()
  })
})

describe('isFiniteNumber', () => {
  it.each<[Cell, boolean]>([
    [5, true], ['-12.5', true], ['9007199254740993', true], ['1e5', true], ['.5', true],
    [null, false], ['', false], ['NaN', false], ['Infinity', false], ['abc', false], [true, false], ['.', false],
  ])('%s is %s', (cell, expected) => {
    expect(isFiniteNumber(cell)).toBe(expected)
  })
})
