import type { Cell, ResultSet } from '@shared/types'

// ── Numbers that arrive as text ──────────────────────────────────────────────
// Large integers and decimals are sent as text so they keep every digit. They are compared and added
// as digit strings here, never through Number, which would round them.

/** A finite decimal number: 0.digits × 10^exp. `digits` has no leading or trailing zeros and is empty for zero. */
interface Decimal { neg: boolean; digits: string; exp: number }

const DECIMAL = /^([+-]?)(\d*)(?:\.(\d*))?(?:e([+-]?\d+))?$/i

function parseDecimal(text: string): Decimal | null {
  const match = DECIMAL.exec(text.trim())
  if (!match || (!match[2] && !match[3])) return null
  const all = match[2] + (match[3] ?? '')
  const lead = all.search(/[1-9]/)
  if (lead < 0) return { neg: false, digits: '', exp: 0 }
  return { neg: match[1] === '-', digits: all.slice(lead).replace(/0+$/, ''), exp: match[2].length + (match[4] ? Number(match[4]) : 0) - lead }
}

function compareDecimals(a: Decimal, b: Decimal): number {
  if (!a.digits || !b.digits) return a.digits ? (a.neg ? -1 : 1) : b.digits ? (b.neg ? 1 : -1) : 0
  if (a.neg !== b.neg) return a.neg ? -1 : 1
  // With no leading zeros the exponent decides the size; with equal exponents the digit strings compare as text.
  const size = a.exp !== b.exp ? (a.exp < b.exp ? -1 : 1) : a.digits < b.digits ? -1 : a.digits > b.digits ? 1 : 0
  return a.neg ? -size : size
}

/** Where a value sits in a numeric column: -Infinity, numbers, Infinity, NaN (as Postgres orders them), then stray text. */
const enum Rank { NegInfinity, Finite, Infinity, NaN, Text }

interface NumericKey { rank: Rank; num?: number; dec?: Decimal; text?: string }

function numericKey(cell: string | number | boolean): NumericKey {
  if (typeof cell === 'boolean') return { rank: Rank.Finite, num: cell ? 1 : 0 }
  if (typeof cell === 'number') {
    if (Number.isNaN(cell)) return { rank: Rank.NaN }
    if (!Number.isFinite(cell)) return { rank: cell > 0 ? Rank.Infinity : Rank.NegInfinity }
    return { rank: Rank.Finite, num: cell }
  }
  const dec = parseDecimal(cell)
  if (dec) return { rank: Rank.Finite, dec }
  const word = cell.trim().toLowerCase()
  if (/^[+-]?nan$/.test(word)) return { rank: Rank.NaN }
  if (/^\+?inf(inity)?$/.test(word)) return { rank: Rank.Infinity }
  if (/^-inf(inity)?$/.test(word)) return { rank: Rank.NegInfinity }
  return { rank: Rank.Text, text: cell }
}

const decimalOf = (key: NumericKey) => (key.dec ??= parseDecimal(String(key.num))!)

function compareNumericKeys(a: NumericKey, b: NumericKey): number {
  if (a.rank !== b.rank) return a.rank - b.rank
  if (a.rank === Rank.Text) return collator.compare(a.text!, b.text!)
  if (a.rank !== Rank.Finite) return 0
  if (a.num !== undefined && b.num !== undefined) return a.num < b.num ? -1 : a.num > b.num ? 1 : 0
  return compareDecimals(decimalOf(a), decimalOf(b))
}

/** One collator for every text comparison: case-insensitive like the databases' defaults (a, B, c), and file2 before file10. */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' })

/** True for a finite number, or text that is one (any length, with or without an exponent). */
export function isFiniteNumber(cell: Cell): boolean {
  if (typeof cell === 'number') return Number.isFinite(cell)
  return typeof cell === 'string' && parseDecimal(cell) !== null
}

/** An integer too large for a JavaScript number. The drivers send only those as text. */
const isBigIntegerText = (cell: Cell) =>
  typeof cell === 'string' && /^-?[1-9]\d{15,}$/.test(cell) && !Number.isSafeInteger(Number(cell))

/** Which columns hold numbers. Large integers and decimals arrive as text so they keep their precision. */
export function numericColumns(set: ResultSet): boolean[] {
  return set.columns.map((column, i) => {
    if (column.kind !== undefined) return column.kind === 'integer' || column.kind === 'decimal' || column.kind === 'float'
    if (column.numeric !== undefined) return column.numeric
    // No word from the driver (SQLite): numeric when every value is a number, or an integer sent as text for its size.
    let seen = false
    for (const row of set.rows) {
      const cell = row[i]
      if (cell === null) continue
      if (typeof cell !== 'number' && !isBigIntegerText(cell)) return false
      seen = true
    }
    return seen
  })
}

/** NULLs sort last in both directions. */
export function compareCells(a: Cell, b: Cell, numeric: boolean, desc: boolean): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  let order: number
  if (numeric) order = compareNumericKeys(numericKey(a), numericKey(b))
  else if (typeof a === 'number' && typeof b === 'number') order = a - b
  else order = collator.compare(String(a), String(b))
  return desc ? -order : order
}

export interface GridSort { column: number; desc: boolean }

/** The rows the grid shows: those containing the filter text (any column, any case), in the chosen order. */
export function filterSortRows(rows: Cell[][], filter: string, sort: GridSort | null, numeric: boolean[]): Cell[][] {
  const term = filter.trim().toLowerCase()
  const kept = term ? rows.filter((row) => row.some((cell) => cell !== null && String(cell).toLowerCase().includes(term))) : rows
  if (!sort) return kept
  const { column, desc } = sort
  if (!numeric[column]) return [...kept].sort((a, b) => compareCells(a[column], b[column], false, desc))
  // Reading a number out of text is the slow part, so do it once per row rather than once per comparison.
  const keys = kept.map((row) => (row[column] === null ? null : numericKey(row[column]!)))
  return kept.map((_, i) => i).sort((i, j) => {
    const a = keys[i]
    const b = keys[j]
    if (a === null) return b === null ? 0 : 1
    if (b === null) return -1
    return desc ? compareNumericKeys(b, a) : compareNumericKeys(a, b)
  }).map((i) => kept[i])
}

// ── Selection ────────────────────────────────────────────────────────────────

export interface CellPosition { row: number; column: number }

/** A rectangle of cells, held as its two corners so it costs the same for one cell or a million. */
export interface GridSelection {
  anchor: CellPosition
  focus: CellPosition
  /** Whole columns were chosen (a header, or everything), so a copy carries the column names even for one row. */
  columns?: boolean
}

export interface CellRange { top: number; bottom: number; left: number; right: number }

export function selectionRange(selection: GridSelection, rowCount: number, columnCount: number): CellRange {
  const clamp = (value: number, count: number) => Math.min(Math.max(value, 0), Math.max(count - 1, 0))
  const rows = [clamp(selection.anchor.row, rowCount), clamp(selection.focus.row, rowCount)]
  const columns = [clamp(selection.anchor.column, columnCount), clamp(selection.focus.column, columnCount)]
  return { top: Math.min(...rows), bottom: Math.max(...rows), left: Math.min(...columns), right: Math.max(...columns) }
}

export const rangeCellCount = (range: CellRange) => (range.bottom - range.top + 1) * (range.right - range.left + 1)

/**
 * The exact total of a range, as text, or null when it is not all numbers. NULLs are passed over, as SUM does.
 * Added as scaled integers, so 0.1 + 0.2 is 0.3 and nineteen-digit integers keep every digit.
 */
export function sumRange(rows: Cell[][], numeric: boolean[], range: CellRange): string | null {
  for (let c = range.left; c <= range.right; c++) if (!numeric[c]) return null
  let total = 0n
  let scale = 0
  let places = 0
  let seen = false
  for (let r = range.top; r <= range.bottom; r++) {
    for (let c = range.left; c <= range.right; c++) {
      const cell = rows[r][c]
      if (cell === null) continue
      if (typeof cell === 'boolean' || !isFiniteNumber(cell)) return null
      const written = String(cell)
      const dec = parseDecimal(written)!
      seen = true
      // Keep the decimal places as written, so prices total to 25.50 and not 25.5.
      if (!/e/i.test(written) && written.includes('.')) places = Math.max(places, written.trim().length - written.trim().indexOf('.') - 1)
      if (!dec.digits) continue
      const fraction = Math.max(dec.digits.length - dec.exp, 0)
      // Values such as 1e-300 or 1e+300 would need hundreds of digits each; no total is shown for those.
      if (fraction > 60 || dec.exp > 400) return null
      if (fraction > scale) {
        total *= 10n ** BigInt(fraction - scale)
        scale = fraction
      }
      const value = BigInt(dec.digits) * 10n ** BigInt(scale - (dec.digits.length - dec.exp))
      total += dec.neg ? -value : value
    }
  }
  if (!seen) return null
  if (places > scale) {
    total *= 10n ** BigInt(places - scale)
    scale = places
  }
  const digits = (total < 0n ? -total : total).toString().padStart(scale + 1, '0')
  const whole = digits.slice(0, digits.length - scale)
  return `${total < 0n ? '-' : ''}${whole}${scale ? `.${digits.slice(digits.length - scale)}` : ''}`
}

/** A starting width for each column, from its header and a sample of its values. */
export function initialWidths(set: ResultSet): number[] {
  return set.columns.map((column, i) => {
    let longest = column.name.length + (column.type ? column.type.length + 1 : 0) + 3
    for (const row of set.rows.slice(0, 60)) longest = Math.max(longest, row[i] === null ? 4 : String(row[i]).length)
    return Math.min(Math.max(longest * 7.4 + 22, 70), 360)
  })
}

/** Identifies a result's shape, so column widths can be kept when the same query is run again. */
export const columnSignature = (set: ResultSet) => set.columns.map((c) => c.name).join('\u0000')
