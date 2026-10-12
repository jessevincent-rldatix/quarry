import { describe, expect, it } from 'vitest'
import type { Cell, ResultColumn, ResultSet } from '@shared/types'
import { selectionText, toCsv, toJson, toMarkdown, toTsv } from './export'

const resultSet = (columns: ResultColumn[], rows: Cell[][] = []): ResultSet => ({ columns, rows, truncated: false })
const one = resultSet([{ name: 'v', type: '' }])
/** The single data field of a one-column, one-row export. */
const field = (out: string) => out.slice('v\r\n'.length)

describe('CSV and TSV', () => {
  it.each<[string, Cell, string, string]>([
    // name, cell, CSV field, TSV field
    ['a formula', '=1+1', "'=1+1", "'=1+1"],
    ['a formula behind a tab', '\t=1+1', "'\t=1+1", '"\'\t=1+1"'],
    ['a formula behind a carriage return', '\r=1+1', '"\'\r=1+1"', '"\'\r=1+1"'],
    ['a leading tab on its own', '\tabc', "'\tabc", '"\'\tabc"'],
    ['an @ command', '@SUM(A1)', "'@SUM(A1)", "'@SUM(A1)"],
    ['a plus that is not a number', '+1 555 0100', "'+1 555 0100", "'+1 555 0100"],
    ['a minus that is not a number', '-cmd', "'-cmd", "'-cmd"],
    ['a negative integer as text', '-5', '-5', '-5'],
    ['a negative decimal as text', '-12.5', '-12.5', '-12.5'],
    ['a negative number with an exponent', '-1e5', '-1e5', '-1e5'],
    ['a signed exponent', '+2.5E-3', '+2.5E-3', '+2.5E-3'],
    ['a number', -5, '-5', '-5'],
    ['plain text', 'abc', 'abc', 'abc'],
    ['a boolean', true, 'true', 'true'],
    ['a comma', 'x,y', '"x,y"', 'x,y'],
    ['a quote', 'say "hi"', '"say ""hi"""', '"say ""hi"""'],
    ['a line break', 'a\nb', '"a\nb"', '"a\nb"'],
    ['NULL', null, '', ''],
    ['the empty string', '', '""', ''],
    ['the text NULL', 'NULL', 'NULL', 'NULL'],
  ])('%s', (_name, cell, csv, tsv) => {
    expect(field(toCsv(one, [[cell]]))).toBe(csv)
    expect(field(toTsv(one, [[cell]]))).toBe(tsv)
  })

  it('tells NULL from the empty string in CSV, and writes whole rows', () => {
    const set = resultSet([{ name: 'a', type: '' }, { name: 'b,c', type: '' }, { name: 'd', type: '' }])
    expect(toCsv(set, [[null, '', 'x'], ['', null, null]])).toBe('a,"b,c",d\r\n,"",x\r\n"",,')
    expect(toTsv(set, [[null, '', 'x']])).toBe('a\tb,c\td\r\n\t\tx')
  })
})

describe('selectionText', () => {
  const set = resultSet([{ name: 'id', type: '' }, { name: 'name', type: '' }, { name: 'note', type: '' }])
  const rows: Cell[][] = [[1, 'Ann', null], [2, 'Bo', '=x'], [3, 'Cy', 'a\tb']]

  it.each<[string, [number, number, number, number], boolean, string]>([
    // name, [top, bottom, left, right], whole columns, clipboard text
    ['one cell is its bare value', [1, 1, 1, 1], false, 'Bo'],
    ['one cell is not neutralised or quoted', [1, 1, 2, 2], false, '=x'],
    ['one NULL cell is empty', [0, 0, 2, 2], false, ''],
    ['one row has no header', [0, 0, 0, 1], false, '1\tAnn'],
    ['several rows have a header', [0, 1, 0, 1], false, 'id\tname\r\n1\tAnn\r\n2\tBo'],
    ['several rows of one column have a header', [0, 2, 1, 1], false, 'name\r\nAnn\r\nBo\r\nCy'],
    ['formulas are neutralised and tabs quoted in a range', [1, 2, 2, 2], false, 'note\r\n\'=x\r\n"a\tb"'],
    ['whole columns have a header', [0, 2, 0, 0], true, 'id\r\n1\r\n2\r\n3'],
  ])('%s', (_name, [top, bottom, left, right], whole, expected) => {
    expect(selectionText(set, rows, { top, bottom, left, right }, whole)).toBe(expected)
  })

  it('gives a whole column its header even when the result has one row', () => {
    expect(selectionText(set, [rows[0]], { top: 0, bottom: 0, left: 1, right: 1 }, true)).toBe('name\r\nAnn')
  })
})

describe('toJson', () => {
  const values = (column: ResultColumn, cells: Cell[]) => {
    const rows = cells.map((cell) => [cell])
    return (JSON.parse(toJson(resultSet([{ ...column, name: 'v' }], rows), rows)) as { v: unknown }[]).map((row) => row.v)
  }

  it.each<[string, Omit<ResultColumn, 'name'>, Cell[], unknown[]]>([
    ['decimals that would lose their zeros all stay text', { type: 'numeric', numeric: true }, ['12.50', '13.00', '14', '0.1', '1.0'],
      ['12.50', '13.00', '14', '0.1', '1.0']],
    ['one value that does not survive keeps the whole column as text', { type: 'numeric', numeric: true }, ['14', '0.1', '1.0'], ['14', '0.1', '1.0']],
    ['numbers beside text that does not survive become text too', { type: 'numeric', numeric: true }, [14, '1.0'], ['14', '1.0']],
    ['text that survives becomes numbers', { type: 'numeric', numeric: true }, ['14', '0.1', '-2.5'], [14, 0.1, -2.5]],
    ['NULL stays null either way', { type: 'numeric', numeric: true }, ['14', null], [14, null]],
    ['NULL stays null in a text column', { type: 'numeric', numeric: true }, ['1.0', null], ['1.0', null]],
    ['a large integer keeps the column as text', { type: 'bigint', kind: 'integer' }, [5, '9007199254740993'], ['5', '9007199254740993']],
    ['safe integers are numbers', { type: 'bigint', kind: 'integer' }, ['5', '6'], [5, 6]],
    ['NaN keeps the column as text', { type: 'numeric', kind: 'decimal' }, ['1', 'NaN'], ['1', 'NaN']],
    ['SQLite, no word from the driver, one large integer', { type: '' }, [9, '9007199254740993'], ['9', '9007199254740993']],
    ['a text column is left alone', { type: 'text', numeric: false }, ['14', '1.0', 'x'], ['14', '1.0', 'x']],
    ['kind text is left alone even if flagged numeric', { type: '', kind: 'text', numeric: true }, ['14'], ['14']],
    ['numbers and booleans in other columns are left alone', { type: '' }, [1, 2.5], [1, 2.5]],
    ['kind json is parsed and nested', { type: 'whatever', kind: 'json' }, ['{"a":[1,2]}', '[1]', '"s"', '3', null], [{ a: [1, 2] }, [1], 's', 3, null]],
    ['kind json that does not parse stays text', { type: '', kind: 'json' }, ['{oops'], ['{oops']],
    ['a json type name without kind is parsed', { type: 'jsonb' }, ['{"a":1}', 'plain'], [{ a: 1 }, 'plain']],
    ['a Postgres array that is not JSON stays text', { type: 'int4[]' }, ['{1,2}'], ['{1,2}']],
    ['a json type name does not win over another kind', { type: 'json_notes', kind: 'text' }, ['{"a":1}'], ['{"a":1}']],
  ])('%s', (_name, column, cells, expected) => {
    expect(values(column as ResultColumn, cells)).toEqual(expected)
  })

  it('decides from the rows being exported, not the whole result', () => {
    const set = resultSet([{ name: 'v', type: 'numeric', numeric: true }], [['1.0'], ['2']])
    expect(JSON.parse(toJson(set, [['2']]))).toEqual([{ v: 2 }])
  })

  it('gives repeated column names a suffix', () => {
    const set = resultSet([{ name: 'id', type: '' }, { name: 'id', type: '' }])
    expect(JSON.parse(toJson(set, [[1, 2]]))).toEqual([{ id: 1, id_2: 2 }])
  })
})

describe('toMarkdown', () => {
  it.each<[string, Cell, string]>([
    ['a pipe', 'p|q', 'p\\|q'],
    ['a backslash', 'a\\b', 'a\\\\b'],
    ['a backslash before a pipe', 'a\\|b', 'a\\\\\\|b'],
    ['a tab', 'a\tb', 'a→b'],
    ['a line break', 'a\nb', 'a↵b'],
    ['a Windows line break', 'a\r\nb', 'a↵b'],
    ['a bare carriage return', 'a\rb', 'a↵b'],
    ['NULL', null, '*NULL*'],
    ['the text NULL', 'NULL', 'NULL'],
    ['the text *NULL*', '*NULL*', '\\*NULL\\*'],
    ['the empty string', '', ''],
    ['a number', 12.5, '12.5'],
  ])('%s', (_name, cell, expected) => {
    expect(toMarkdown(one, [[cell]])).toBe(`| v |\n| --- |\n| ${expected} |`)
  })

  it('escapes column names too', () => {
    expect(toMarkdown(resultSet([{ name: 'a|b', type: '' }, { name: 'c', type: '' }]), [[1, null]])).toBe('| a\\|b | c |\n| --- | --- |\n| 1 | *NULL* |')
  })
})
