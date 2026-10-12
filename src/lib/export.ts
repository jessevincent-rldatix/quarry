import type { Cell, ResultColumn, ResultSet } from '@shared/types'
import { numericColumns, type CellRange } from './results'

const PLAIN_NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

/**
 * Text that a spreadsheet would run as a formula gets a leading apostrophe. A leading tab or carriage return counts
 * too, because spreadsheets skip them and run what follows. Numbers such as -5, -12.5 and -1e5 are left alone.
 */
const defuse = (cell: Cell) =>
  cell === null ? '' : typeof cell === 'string' && /^[=+\-@\t\r]/.test(cell) && !PLAIN_NUMBER.test(cell) ? `'${cell}` : String(cell)

interface DelimitedOptions {
  header: boolean
  /** Write the empty string as "" so it differs from NULL, which is an empty field. Loaders such as Postgres COPY read it that way. */
  quoteEmpty: boolean
}

function delimited(columns: ResultColumn[], rows: Cell[][], separator: string, { header, quoteEmpty }: DelimitedOptions): string {
  const escape = (value: string) => (/["\r\n]/.test(value) || value.includes(separator) ? `"${value.replace(/"/g, '""')}"` : value)
  const field = (cell: Cell) => (quoteEmpty && cell === '' ? '""' : escape(defuse(cell)))
  const lines = rows.map((row) => row.map(field).join(separator))
  if (header) lines.unshift(columns.map((c) => escape(c.name)).join(separator))
  return lines.join('\r\n')
}

export const toCsv = (set: ResultSet, rows: Cell[][]) => delimited(set.columns, rows, ',', { header: true, quoteEmpty: true })
/** For pasting into a spreadsheet, where "" would show up as two quote marks: NULL and the empty string are both empty. */
export const toTsv = (set: ResultSet, rows: Cell[][]) => delimited(set.columns, rows, '\t', { header: true, quoteEmpty: false })

/**
 * What Ctrl+C puts on the clipboard for a selection in the grid. One cell is its bare value. Anything larger is
 * tab-separated, with the column names on top when there is more than one row or whole columns were chosen.
 */
export function selectionText(set: ResultSet, rows: Cell[][], range: CellRange, wholeColumns = false): string {
  const single = range.top === range.bottom && range.left === range.right
  if (single && !wholeColumns) {
    const cell = rows[range.top]?.[range.left] ?? null
    return cell === null ? '' : String(cell)
  }
  const body = rows.slice(range.top, range.bottom + 1).map((row) => row.slice(range.left, range.right + 1))
  return delimited(set.columns.slice(range.left, range.right + 1), body, '\t', { header: wholeColumns || range.bottom > range.top, quoteEmpty: false })
}

// NaN and Infinity have no JSON number, so text holding them does not count.
const roundTrips = (cell: Cell) =>
  typeof cell === 'number' || (typeof cell === 'string' && Number.isFinite(Number(cell)) && String(Number(cell)) === cell)

export function toJson(set: ResultSet, rows: Cell[][]): string {
  // Two columns with the same name (a join with SELECT *) would overwrite each other, so later ones get a suffix.
  const seen = new Map<string, number>()
  const keys = set.columns.map((c) => {
    const count = (seen.get(c.name) ?? 0) + 1
    seen.set(c.name, count)
    return count === 1 ? c.name : `${c.name}_${count}`
  })
  const numeric = numericColumns(set)
  const convert = set.columns.map((column, i): ((cell: Cell) => unknown) => {
    if (column.kind === 'json') return (cell) => {
      if (typeof cell !== 'string') return cell
      try { return JSON.parse(cell) } catch { return cell }
    }
    if (column.kind === undefined && /json|array|\[\]$|^_/i.test(column.type)) return (cell) => {
      if (typeof cell !== 'string' || !/^\s*[[{]/.test(cell)) return cell
      try { return JSON.parse(cell) } catch { return cell }
    }
    if (!numeric[i]) return (cell) => cell
    // Numbers sent as text to keep precision. One type per column: numbers only when every value survives the
    // trip through a JavaScript number unchanged, otherwise every value stays text exactly as the database wrote it.
    const exact = rows.every((row) => row[i] === null || roundTrips(row[i]))
    return (cell) => (cell === null ? null : exact ? Number(cell) : String(cell))
  })
  return JSON.stringify(rows.map((row) => Object.fromEntries(keys.map((key, i) => [key, convert[i](row[i])]))), null, 2)
}

export function toMarkdown(set: ResultSet, rows: Cell[][]): string {
  // Backslashes first, or the one added in front of a pipe would itself be doubled. Asterisks are escaped so the
  // text *NULL* cannot pass for a real NULL, which is written in italics.
  const escape = (value: string) => value
    .replace(/\\/g, '\\\\').replace(/\|/g, '\\|').replace(/\*/g, '\\*')
    .replace(/\r\n|\r|\n/g, '↵').replace(/\t/g, '→')
  const line = (cells: string[]) => `| ${cells.join(' | ')} |`
  return [
    line(set.columns.map((c) => escape(c.name))),
    line(set.columns.map(() => '---')),
    ...rows.map((row) => line(row.map((cell) => (cell === null ? '*NULL*' : escape(String(cell)))))),
  ].join('\n')
}

export function download(filename: string, content: string, type: string): void {
  // The BOM makes Excel read the file as UTF-8.
  const blob = new Blob([type === 'text/csv' ? '﻿' : '', content], { type: `${type};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}
