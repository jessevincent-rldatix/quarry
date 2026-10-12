import { useDeferredValue, useMemo, useState } from 'react'
import { ClipboardCopy, Download, Loader2, Sparkles } from 'lucide-react'
import type { Cell, ResultSet } from '@shared/types'
import { useElapsed } from '@/hooks/useElapsed'
import { download, toCsv, toJson, toMarkdown, toTsv } from '@/lib/export'
import { columnSignature, filterSortRows, initialWidths, numericColumns, rangeCellCount, selectionRange, sumRange, type GridSelection } from '@/lib/results'
import { cn } from '@/lib/utils'
import { emptyGrid, useStore, type GridState, type Tab } from '@/store'
import { Button } from '@/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/ui/dialog'
import { Pill } from '@/ui/input'
import { ConnectionSource } from './ConnectionSource'
import { ResultChart } from './ResultChart'
import { ResultGrid } from './ResultGrid'

const EMPTY = emptyGrid()
// Adding up a selection reads every cell in it; past this many the status line gives the count alone.
const SUM_LIMIT = 200_000

/** Everything under the editor: result tabs, the grid or chart, messages, errors and the status line. */
export function ResultsPanel({ tab, onGoToLine }: { tab: Tab; onGoToLine: (line: number) => void }) {
  const run = useStore((s) => s.runs[tab.id])
  const grid = useStore((s) => s.grids[tab.id]) ?? EMPTY
  const aiReady = useStore((s) => s.ai?.configured ?? false)
  const [copied, setCopied] = useState('')
  const elapsed = useElapsed(Boolean(run?.running), run?.startedAt)
  const update = (patch: Partial<GridState>) => useStore.getState().setGrid(tab.id, patch)

  const response = run?.response
  const sets = response?.resultSets ?? []
  const setIndex = Math.min(grid.setIndex, Math.max(0, sets.length - 1))
  const set = sets[setIndex] as ResultSet | undefined
  const failure = run?.error ?? response?.error?.message
  // Cut short on purpose, by the Stop button or the time limit: not a failure, and not a finished run either.
  const stopped = run?.error ? undefined : response?.stopped
  const signature = set ? columnSignature(set) : ''

  const numeric = useMemo(() => (set ? numericColumns(set) : []), [set])
  // A sort column from a previous, differently shaped result does not apply to this one.
  const sort = grid.sort && set && grid.sort.column < set.columns.length ? grid.sort : null
  const rows = useMemo(() => (set ? filterSortRows(set.rows, grid.filter, sort, numeric) : []), [set, grid.filter, sort, numeric])

  // The selection is row and column numbers, so it only means something for the rows it was made on:
  // a new filter, sort or run drops it.
  const [picked, setPicked] = useState<{ rows: Cell[][]; value: GridSelection } | null>(null)
  const selection = picked && picked.rows === rows ? picked.value : null
  // Deferred, so dragging across a large result is not held up by adding it up.
  const settled = useDeferredValue(selection)
  const summary = useMemo(() => {
    if (!settled || !set || rows.length === 0) return null
    const range = selectionRange(settled, rows.length, set.columns.length)
    const cells = rangeCellCount(range)
    return cells < 2 ? null : { cells, sum: cells <= SUM_LIMIT ? sumRange(rows, numeric, range) : null }
  }, [settled, set, rows, numeric])
  const widths = useMemo(() => (set ? grid.widths[signature] ?? initialWidths(set) : []), [set, grid.widths, signature])

  const toggleSort = (column: number) =>
    update({ sort: sort?.column !== column ? { column, desc: false } : sort.desc ? null : { column, desc: true } })

  const copy = (label: string, text: string) => {
    void navigator.clipboard.writeText(text)
    setCopied(label)
    setTimeout(() => setCopied(''), 1500)
  }

  const messages = [
    ...(response?.messages ?? []),
    ...(response && response.rowsAffected !== null ? [`${response.rowsAffected.toLocaleString()} row${response.rowsAffected === 1 ? '' : 's'} affected.`] : []),
    ...(response && !failure && sets.length === 0 && response.rowsAffected === null && response.messages.length === 0 ? ['The statement ran and returned no rows.'] : []),
  ]
  // With nothing to show in a grid, the messages are the result.
  const mode = response && sets.length === 0 ? 'messages' : grid.mode
  const tabButton = (id: GridState['mode'], label: string) => (
    <button onClick={() => update({ mode: id })} className={cn('relative h-9 px-2.5 text-[12.5px]', mode === id ? 'font-medium text-ink' : 'text-ink-mute hover:text-ink')}>
      {label}
      {mode === id && <span className="absolute inset-x-1.5 bottom-0 h-0.5 rounded-full bg-accent" />}
    </button>
  )

  const askToFix = () => {
    useStore.getState().set({ askOpen: true })
    void useStore.getState().ask('This query failed. What is wrong, and what is the corrected query?', { sql: true, error: true })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-line bg-panel-header px-2">
        {tabButton('results', 'Results')}
        {tabButton('chart', 'Chart')}
        {tabButton('messages', messages.length ? `Messages (${messages.length})` : 'Messages')}
        {sets.length > 1 && (
          <div className="ml-2 flex items-center gap-1">
            {sets.map((s, i) => (
              <button key={i} onClick={() => update({ setIndex: i })} title={`${s.rows.length.toLocaleString()} rows`}
                      className={cn('h-6 rounded-md px-2 text-[12px]', i === setIndex ? 'bg-brand text-white' : 'text-ink hover:bg-black/[0.05]')}>
                Result {i + 1}
              </button>
            ))}
          </div>
        )}
        <div className="ml-auto flex items-center gap-1">
          {set && mode === 'results' && (
            <>
              <input value={grid.filter} onChange={(e) => update({ filter: e.target.value })} placeholder="Filter rows" aria-label="Filter rows"
                     className="h-[26px] w-40 rounded-md border border-line bg-white px-2 text-[12px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" />
              <Menu>
                <MenuTrigger asChild><Button variant="ghost" size="xs"><ClipboardCopy className="size-3.5" />{copied && copied !== 'selection' ? `Copied ${copied}` : 'Copy as'}</Button></MenuTrigger>
                <MenuContent align="end">
                  <MenuItem onSelect={() => copy('TSV', toTsv(set, rows))}>Tab-separated, for Excel</MenuItem>
                  <MenuItem onSelect={() => copy('CSV', toCsv(set, rows))}>CSV</MenuItem>
                  <MenuItem onSelect={() => copy('JSON', toJson(set, rows))}>JSON</MenuItem>
                  <MenuItem onSelect={() => copy('Markdown', toMarkdown(set, rows))}>Markdown table</MenuItem>
                </MenuContent>
              </Menu>
              <Button variant="ghost" size="xs" onClick={() => download(`${tab.title.replace(/[^\w-]+/g, '_') || 'result'}.csv`, toCsv(set, rows), 'text/csv')}>
                <Download className="size-3.5" />Export CSV
              </Button>
            </>
          )}
        </div>
      </div>

      {failure && !run?.running && (
        <div className="flex shrink-0 flex-wrap items-start gap-x-3 gap-y-1 border-b border-red-200 bg-red-50 px-3 py-2">
          <pre className="min-w-0 flex-1 whitespace-pre-wrap break-words font-mono text-[12.5px] text-red-900">{failure}</pre>
          {run?.errorLine !== undefined && <Button variant="outline" size="xs" onClick={() => onGoToLine(run.errorLine!)}>Go to line {run.errorLine}</Button>}
          {aiReady && <Button variant="outline" size="xs" onClick={askToFix}><Sparkles className="size-3.5 text-accent-deep" />Ask how to fix it</Button>}
        </div>
      )}

      <div className="min-h-0 flex-1">
        {run?.running ? (
          <div className="flex h-full items-center justify-center gap-2 text-ink-mute"><Loader2 className="size-4 animate-spin text-accent-deep" />Running · {elapsed.toFixed(1)} s</div>
        ) : !response ? (
          <div className="flex h-full items-center justify-center text-ink-mute">{failure ? '' : 'Run a query to see its results here.'}</div>
        ) : mode === 'messages' || !set ? (
          <div className="scrollbars-visible h-full overflow-auto p-4 font-mono text-[12.5px]">
            {messages.length ? messages.map((m, i) => <div key={i} className="whitespace-pre-wrap">{m}</div>) : <span className="font-sans text-ink-mute">No messages.</span>}
          </div>
        ) : mode === 'chart' ? (
          <ResultChart key={`${setIndex}-${signature}`} set={set} rows={rows} numeric={numeric} />
        ) : (
          <ResultGrid key={`${setIndex}-${run?.at}`} set={set} rows={rows} numeric={numeric} widths={widths}
                      onWidths={(next) => update({ widths: { ...grid.widths, [signature]: next } })} sort={sort} onSort={toggleSort}
                      selection={selection} onSelection={(value) => setPicked({ rows, value })} onCopy={(text) => copy('selection', text)} />
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-line bg-panel px-3 py-1 text-[12px] text-ink-mute">
        {run?.running ? <Pill className="bg-sky-100 text-sky-800">Running</Pill>
          : stopped === 'user' ? <Pill className="bg-panel-header text-ink">Stopped</Pill>
          : stopped === 'timeout' ? <Pill className="bg-var-bg text-var-ink">Timed out</Pill>
          : failure ? <Pill className="bg-red-100 text-red-800">Failed</Pill>
          : response ? <Pill className="bg-emerald-100 text-emerald-800">Done</Pill>
          : <Pill className="bg-panel-header text-ink-mute">Idle</Pill>}
        {set && <span>{rows.length === set.rows.length ? `${set.rows.length.toLocaleString()} row${set.rows.length === 1 ? '' : 's'}` : `${rows.length.toLocaleString()} of ${set.rows.length.toLocaleString()} rows`}</span>}
        {sets.length > 1 && <span>result {setIndex + 1} of {sets.length}</span>}
        {summary && mode === 'results' && (
          <span aria-live="polite">
            {summary.cells.toLocaleString()} cells selected{summary.sum !== null && <> · sum <span className="font-mono text-ink">{summary.sum}</span></>}
            {copied === 'selection' && ' · copied'}
          </span>
        )}
        {set?.truncated && response && <span className="font-medium text-var-ink">Stopped at the {response.maxRows.toLocaleString()} row limit. Raise it in the toolbar and run again to see more.</span>}
        {response && <span>{response.ms.toLocaleString()} ms</span>}
        {!run?.running && (response || failure) && run?.connectionId && <ConnectionSource sourceId={run.connectionId} tabConnectionId={tab.connectionId} />}
      </div>
    </div>
  )
}
