import { useMemo, useState } from 'react'
import type { Cell, ResultSet } from '@shared/types'
import { isFiniteNumber } from '@/lib/results'
import { cn } from '@/lib/utils'

const MAX_BARS = 40
const picker = 'h-7 rounded-md border border-line bg-white px-2 text-[12px]'

/** A horizontal bar chart of one numeric column, labelled by another column. Negative values run left of a zero line. */
export function ResultChart({ set, rows, numeric }: { set: ResultSet; rows: Cell[][]; numeric: boolean[] }) {
  const numbers = set.columns.map((_, i) => i).filter((i) => numeric[i])
  const [valueColumn, setValueColumn] = useState(numbers[numbers.length - 1] ?? -1)
  const [labelColumn, setLabelColumn] = useState(set.columns.findIndex((_, i) => !numeric[i]))
  const value = numbers.includes(valueColumn) ? valueColumn : numbers[0] ?? -1

  // NULL, NaN and Infinity have no length to draw, so those rows are left out and counted instead.
  const { bars, plottable, skipped } = useMemo(() => {
    const bars: { index: number; row: Cell[]; amount: number }[] = []
    let plottable = 0
    if (value >= 0) {
      rows.forEach((row, index) => {
        const amount = Number(row[value])
        if (!isFiniteNumber(row[value]) || !Number.isFinite(amount)) return
        plottable++
        if (bars.length < MAX_BARS) bars.push({ index, row, amount })
      })
    }
    return { bars, plottable, skipped: value >= 0 ? rows.length - plottable : 0 }
  }, [rows, value])

  if (numbers.length === 0) return <div className="p-6 text-ink-mute">A chart needs at least one numeric column in the result.</div>

  const low = Math.min(0, ...bars.map((bar) => bar.amount))
  const high = Math.max(0, ...bars.map((bar) => bar.amount))
  const span = high - low || 1
  const zero = (-low / span) * 100
  const label = (bar: { index: number; row: Cell[] }) => (labelColumn >= 0 ? String(bar.row[labelColumn] ?? 'NULL') : String(bar.index + 1))
  // Large integers and decimals arrive as text; show them as written rather than through a rounded number.
  const written = (cell: Cell) => (typeof cell === 'number' ? cell.toLocaleString() : String(cell))

  return (
    <div className="scrollbars-visible h-full overflow-auto p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-ink-mute">
        <label className="flex items-center gap-1.5">Bars
          <select className={picker} value={value} onChange={(e) => setValueColumn(Number(e.target.value))}>
            {numbers.map((i) => <option key={i} value={i}>{set.columns[i].name}</option>)}
          </select>
        </label>
        <label className="flex items-center gap-1.5">Labels
          <select className={picker} value={labelColumn} onChange={(e) => setLabelColumn(Number(e.target.value))}>
            <option value={-1}>Row number</option>
            {set.columns.map((c, i) => <option key={i} value={i}>{c.name}</option>)}
          </select>
        </label>
        {plottable > bars.length && <span>Showing the first {bars.length} of {plottable.toLocaleString()} rows</span>}
        {skipped > 0 && <span>{skipped.toLocaleString()} row{skipped === 1 ? '' : 's'} left out: {set.columns[value].name} is NULL or not a finite number</span>}
        {low < 0 && (
          <span className="flex items-center gap-1.5">
            <span className="size-2.5 rounded-sm bg-brand" />Positive
            <span className="ml-1.5 size-2.5 rounded-sm bg-var-ink" />Negative
          </span>
        )}
      </div>
      {bars.length === 0 && <div className="py-4 text-ink-mute">No row has a number in {set.columns[value].name}.</div>}
      <div className="grid grid-cols-[minmax(80px,220px)_1fr_auto] items-center gap-x-3 gap-y-1.5 text-[12px]">
        {bars.map((bar) => {
          const share = (Math.abs(bar.amount) / span) * 100
          const negative = bar.amount < 0
          return (
            <div key={bar.index} className="contents" title={`${label(bar)}: ${written(bar.row[value])}`}>
              <div className="truncate text-right">{label(bar)}</div>
              <div className="relative h-4 rounded bg-panel-header">
                {/* Square at the zero line, rounded at the end that carries the value. */}
                <div className={cn('absolute inset-y-0', negative ? 'rounded-l bg-var-ink' : 'rounded-r bg-brand')}
                     style={{ left: `${negative ? zero - share : zero}%`, width: `${share}%`, minWidth: bar.amount === 0 ? 0 : 1 }} />
                {low < 0 && <div className="absolute -bottom-[3px] -top-[3px] w-px bg-ink-mute" style={{ left: `${zero}%` }} />}
              </div>
              <div className="text-right font-mono text-[#0369a1]">{written(bar.row[value])}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
