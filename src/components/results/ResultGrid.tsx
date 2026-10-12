import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { ArrowDown, ArrowUp } from 'lucide-react'
import type { Cell, ResultSet } from '@shared/types'
import { selectionText } from '@/lib/export'
import { selectionRange, type CellPosition, type GridSelection } from '@/lib/results'
import { cn } from '@/lib/utils'
import { CellViewer } from './CellViewer'

const ROW_HEIGHT = 26
const HEADER_HEIGHT = 32
const INDEX_WIDTH = 52

interface Props {
  set: ResultSet
  rows: Cell[][]
  numeric: boolean[]
  widths: number[]
  onWidths: (widths: number[]) => void
  sort: { column: number; desc: boolean } | null
  onSort: (column: number) => void
  /** The selected rectangle, as two corners. Held by the panel so the status line can describe it. */
  selection: GridSelection | null
  onSelection: (selection: GridSelection) => void
  onCopy: (text: string) => void
}

/** A virtualised grid: only the rows on screen exist in the page, so large results stay quick. */
export function ResultGrid({ set, rows, numeric, widths, onWidths, sort, onSort, selection, onSelection, onCopy }: Props) {
  const scroller = useRef<HTMLDivElement>(null)
  // Set while the mouse button is down: where the drag began, and whether it began on a row number.
  const drag = useRef<{ anchor: CellPosition; wholeRows: boolean } | null>(null)
  const [viewing, setViewing] = useState<{ cell: Cell; column: string } | null>(null)
  const [dragging, setDragging] = useState<number[] | null>(null)
  const shown = dragging ?? widths

  // The viewer takes focus for its value, so the dialog cannot hand focus back by itself when it closes.
  const wasViewing = useRef(false)
  useEffect(() => {
    if (wasViewing.current && !viewing) scroller.current?.focus()
    wasViewing.current = viewing !== null
  }, [viewing])

  const virtual = useVirtualizer({
    count: rows.length, getScrollElement: () => scroller.current, estimateSize: () => ROW_HEIGHT, overscan: 12,
    // Keep the selected row clear of the sticky header and the horizontal scrollbar.
    scrollPaddingStart: HEADER_HEIGHT, scrollPaddingEnd: 14,
  })
  const total = INDEX_WIDTH + shown.reduce((sum, w) => sum + w, 0)
  const lastRow = rows.length - 1
  const lastColumn = set.columns.length - 1
  const range = selection && rows.length > 0 ? selectionRange(selection, rows.length, set.columns.length) : null

  const startResize = (index: number, event: React.PointerEvent) => {
    event.preventDefault()
    event.stopPropagation()
    const startX = event.clientX
    let latest = widths
    const move = (e: PointerEvent) => {
      latest = widths.map((w, i) => (i === index ? Math.max(50, w + e.clientX - startX) : w))
      setDragging(latest)
    }
    const stop = () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', stop)
      setDragging(null)
      onWidths(latest)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', stop)
  }

  const beginDrag = (anchor: CellPosition, wholeRows: boolean) => {
    drag.current = { anchor, wholeRows }
    window.addEventListener('pointerup', () => { drag.current = null }, { once: true })
  }

  const pressCell = (position: CellPosition, event: React.PointerEvent) => {
    if (event.button !== 0) return
    const anchor = event.shiftKey && selection ? selection.anchor : position
    onSelection({ anchor, focus: position })
    beginDrag(anchor, false)
  }

  const pressRowNumber = (row: number, event: React.PointerEvent) => {
    if (event.button !== 0) return
    const anchor = { row: event.shiftKey && selection ? selection.anchor.row : row, column: 0 }
    onSelection({ anchor, focus: { row, column: lastColumn } })
    beginDrag(anchor, true)
  }

  const dragOver = (row: number, column: number) => {
    if (!drag.current) return
    onSelection({ anchor: drag.current.anchor, focus: { row, column: drag.current.wholeRows ? lastColumn : column } })
  }

  const selectColumns = (from: number, to: number) => {
    if (lastRow < 0) return
    onSelection({ anchor: { row: 0, column: from }, focus: { row: lastRow, column: to }, columns: true })
    // The click landed on a header button; the keys (Ctrl+C, arrows) belong to the grid.
    scroller.current?.focus()
  }

  const pressHeader = (column: number, event: React.MouseEvent) => {
    if (!event.ctrlKey && !event.metaKey) return onSort(column)
    selectColumns(event.shiftKey && selection ? selection.anchor.column : column, column)
  }

  const reveal = (position: CellPosition) => {
    virtual.scrollToIndex(position.row)
    const box = scroller.current
    if (!box) return
    const left = shown.slice(0, position.column).reduce((sum, w) => sum + w, 0)
    if (left < box.scrollLeft) box.scrollLeft = left
    else if (INDEX_WIDTH + left + shown[position.column] > box.scrollLeft + box.clientWidth) box.scrollLeft = INDEX_WIDTH + left + shown[position.column] - box.clientWidth
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    // Keys pressed on a header button, or inside the cell viewer (whose events bubble here), are not for the grid.
    if (event.target !== event.currentTarget || lastRow < 0 || lastColumn < 0) return
    const mod = event.ctrlKey || event.metaKey
    const key = event.key
    if (mod && key.toLowerCase() === 'a') {
      event.preventDefault()
      onSelection({ anchor: { row: 0, column: 0 }, focus: { row: lastRow, column: lastColumn }, columns: true })
      return
    }
    if (!selection || !range) {
      if (!key.startsWith('Arrow')) return
      event.preventDefault()
      onSelection({ anchor: { row: 0, column: 0 }, focus: { row: 0, column: 0 } })
      reveal({ row: 0, column: 0 })
      return
    }
    const focus = { row: Math.min(selection.focus.row, lastRow), column: Math.min(selection.focus.column, lastColumn) }
    const step = (rowStep: number, columnStep: number) => {
      event.preventDefault()
      // With Ctrl the move goes to the edge of the result.
      const along = (at: number, by: number, last: number) => (by === 0 ? at : mod ? (by > 0 ? last : 0) : Math.min(Math.max(at + by, 0), last))
      const next = { row: along(focus.row, rowStep, lastRow), column: along(focus.column, columnStep, lastColumn) }
      // Shift stretches the selection from where it began; without it the selection moves as one cell.
      onSelection(event.shiftKey ? { anchor: selection.anchor, focus: next, columns: rowStep === 0 && selection.columns } : { anchor: next, focus: next })
      reveal(next)
    }
    if (key === 'ArrowDown') step(1, 0)
    else if (key === 'ArrowUp') step(-1, 0)
    else if (key === 'ArrowRight') step(0, 1)
    else if (key === 'ArrowLeft') step(0, -1)
    else if (key === 'Enter') {
      // Without this the same keystroke goes on to press whatever the viewer focuses, and closes it again.
      event.preventDefault()
      if (!event.repeat) setViewing({ cell: rows[focus.row][focus.column], column: set.columns[focus.column].name })
    } else if (key === 'Escape') {
      if (range.top !== range.bottom || range.left !== range.right) onSelection({ anchor: focus, focus })
    } else if (key === ' ' && mod) {
      event.preventDefault()
      selectColumns(range.left, range.right)
    } else if (key === ' ' && event.shiftKey) {
      event.preventDefault()
      onSelection({ anchor: { row: range.top, column: 0 }, focus: { row: range.bottom, column: lastColumn } })
    } else if (key.toLowerCase() === 'c' && mod) {
      event.preventDefault()
      onCopy(selectionText(set, rows, range, selection.columns))
    }
  }

  return (
    <div ref={scroller} tabIndex={0} onKeyDown={onKeyDown} role="grid" aria-rowcount={rows.length} aria-multiselectable
         className="scrollbars-visible h-full overflow-auto bg-white outline-none">
      <div style={{ width: total, minWidth: '100%' }}>
        <div className="sticky top-0 z-10 flex border-b border-line bg-panel text-[12.5px]" style={{ height: HEADER_HEIGHT }} role="row">
          <button onClick={() => selectColumns(0, lastColumn)} aria-label="Select all cells" title="Select all (Ctrl+A)"
                  className="flex shrink-0 items-center justify-end px-2.5 text-ink-mute hover:bg-panel-header" style={{ width: INDEX_WIDTH }}>#</button>
          {set.columns.map((column, i) => (
            <div key={i} role="columnheader" className={cn('relative flex shrink-0 items-center border-l border-line-soft', range && i >= range.left && i <= range.right && 'bg-panel-header')} style={{ width: shown[i] }}>
              <button onClick={(e) => pressHeader(i, e)} title={`Sort by ${column.name}. Ctrl+click selects the column.`}
                      className={cn('flex h-full min-w-0 flex-1 items-center gap-1.5 px-2.5 text-left font-semibold hover:bg-panel-header', numeric[i] && 'justify-end')}>
                <span className="truncate">{column.name}</span>
                {column.type && <span className="shrink-0 text-[11px] font-normal text-ink-mute">{column.type}</span>}
                {sort?.column === i && (sort.desc ? <ArrowDown className="size-3 shrink-0 text-accent-deep" /> : <ArrowUp className="size-3 shrink-0 text-accent-deep" />)}
              </button>
              <div onPointerDown={(e) => startResize(i, e)} className="absolute -right-1 top-0 z-10 h-full w-2 cursor-col-resize hover:bg-accent/40" />
            </div>
          ))}
        </div>
        {/* No text selection here: dragging selects cells, and Ctrl+C copies them. */}
        <div className="relative select-none font-mono text-[12px]" style={{ height: virtual.getTotalSize() }}>
          {virtual.getVirtualItems().map((item) => {
            const row = rows[item.index]
            const inRows = range !== null && item.index >= range.top && item.index <= range.bottom
            return (
              <div key={item.index} role="row" aria-rowindex={item.index + 1} className="absolute left-0 flex border-b border-line-soft hover:bg-panel/70"
                   style={{ top: item.start, height: ROW_HEIGHT, width: total, minWidth: '100%' }}>
                <div title="Select the row" onPointerDown={(e) => pressRowNumber(item.index, e)} onPointerEnter={() => dragOver(item.index, 0)}
                     className={cn('flex shrink-0 cursor-default items-center justify-end px-2.5 text-ink-mute hover:bg-panel-header', inRows && 'bg-panel-header font-semibold text-ink')}
                     style={{ width: INDEX_WIDTH }}>{item.index + 1}</div>
                {row.map((cell, c) => {
                  const picked = inRows && c >= range.left && c <= range.right
                  const active = selection?.focus.row === item.index && selection.focus.column === c
                  return (
                    <div key={c} role="gridcell" aria-selected={picked}
                         onPointerDown={(e) => pressCell({ row: item.index, column: c }, e)}
                         onPointerEnter={() => dragOver(item.index, c)}
                         onDoubleClick={() => setViewing({ cell, column: set.columns[c].name })}
                         className={cn(
                           'flex shrink-0 items-center overflow-hidden whitespace-nowrap border-l border-line-soft px-2.5',
                           numeric[c] && cell !== null && 'justify-end text-[#0369a1]',
                           cell === null && 'italic text-ink-mute',
                           picked && !active && 'bg-mint/30',
                           active && 'bg-mint/50 outline outline-1 -outline-offset-1 outline-brand',
                         )}
                         style={{ width: shown[c] }}>
                      <span className="truncate">{cell === null ? 'NULL' : typeof cell === 'boolean' ? String(cell) : cell}</span>
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>
      {viewing && <CellViewer {...viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}
