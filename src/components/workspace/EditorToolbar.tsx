import { AlignLeft, Blocks, FileStack, Play, Save, Sparkles, Square } from 'lucide-react'
import { useElapsed } from '@/hooks/useElapsed'
import { cn, kbd } from '@/lib/utils'
import { useStore, type Tab } from '@/store'
import { Button } from '@/ui/button'
import { connectionPaint } from '@/ui/connection-color'
import { Pill } from '@/ui/input'

// How long a run may take before the server stops it. 0 means no limit.
const TIME_LIMITS: [number, string][] = [[0, 'No limit'], [30_000, '30 s'], [60_000, '1 min'], [300_000, '5 min'], [600_000, '10 min'], [1_800_000, '30 min']]

/** Run, stop, format and save for the active tab, plus where the query is filed, the row limit and the time limit. */
export function EditorToolbar({ tab, onFormat, notice }: { tab: Tab; onFormat: () => void; notice: string }) {
  const run = useStore((s) => s.runs[tab.id])
  const maxRows = useStore((s) => s.maxRows)
  const timeoutMs = useStore((s) => s.timeoutMs)
  const connection = useStore((s) => s.connections.find((c) => c.id === tab.connectionId))
  const paint = connectionPaint(connection?.color)
  const saved = useStore((s) => s.queries.find((q) => q.id === tab.queryId))
  const folderName = useStore((s) => s.folders.find((f) => f.id === saved?.folderId)?.name)
  const askOpen = useStore((s) => s.askOpen)
  const elapsed = useElapsed(Boolean(run?.running), run?.startedAt)
  const { runTab, cancelRun, saveTab, setDialog, set } = useStore.getState()

  return (
    <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-1 border-b border-line-soft px-2 py-1">
      {run?.running ? (
        <Button size="xs" variant="destructive" onClick={() => cancelRun(tab.id)} title="Stop the running query">
          <Square className="size-3 fill-current" />Stop <span className="text-[10px] font-normal tabular-nums">{elapsed.toFixed(1)} s</span>
        </Button>
      ) : (
        // kbd() adds the Ctrl, so these read "Ctrl Enter" and "Ctrl Shift Enter", which are the editor's bindings.
        <Button size="xs" onClick={() => void runTab(tab.id)} className={paint?.button}
                title={`Run everything, or the selected text, on ${connection?.name ?? 'a removed connection'} (${kbd('Enter')}). ${kbd('Shift Enter')} in the editor runs only the statement the cursor is in.`}>
          <Play className="size-3 fill-current" />Run
          {/* A marked connection is named on the button itself, so the warning does not rest on colour alone. */}
          {paint && connection && <span className="max-w-[140px] truncate">on {connection.name}</span>}
          <span className={cn('text-[10px] font-normal', paint ? 'text-white/85' : 'text-chrome-text')}>{kbd('Enter')}</span>
        </Button>
      )}
      <Button variant="ghost" size="xs" onClick={onFormat} title="Shift Alt F"><AlignLeft className="size-3.5" />Format</Button>
      <Button variant="ghost" size="xs" onClick={() => set({ view: 'builder' })}><Blocks className="size-3.5" />Builder</Button>
      <Button variant="ghost" size="xs" onClick={() => saveTab(tab.id)} title={kbd('S')}><Save className="size-3.5" />Save</Button>
      {tab.queryId && <Button variant="ghost" size="xs" onClick={() => setDialog({ kind: 'save', tabId: tab.id })}>Save as</Button>}
      <Button variant="ghost" size="xs" onClick={() => setDialog({ kind: 'template', sql: tab.sql })}><FileStack className="size-3.5" />Save as template</Button>
      <Button variant="ghost" size="xs" aria-pressed={askOpen} onClick={() => set({ askOpen: !askOpen })} title={kbd('I')}><Sparkles className="size-3.5 text-accent-deep" />Ask</Button>
      {notice && <span className="text-[12px] text-red-700">{notice}</span>}
      <div className="ml-auto flex min-w-0 items-center gap-2 text-[12px] text-ink-mute">
        {folderName && <span className="truncate">{folderName}</span>}
        {saved?.tags.slice(0, 3).map((tag) => <Pill key={tag} className="shrink-0 bg-panel-header text-ink">#{tag}</Pill>)}
        {saved && saved.tags.length > 3 && <span className="shrink-0" title={saved.tags.slice(3).map((t) => `#${t}`).join(' ')}>+{saved.tags.length - 3}</span>}
        <label className="flex shrink-0 items-center gap-1.5">Limit
          <select value={maxRows} onChange={(e) => set({ maxRows: Number(e.target.value) })}
                  className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink">
            {[100, 500, 5000, 50000].map((n) => <option key={n} value={n}>{n.toLocaleString()} rows</option>)}
          </select>
        </label>
        <label className="flex shrink-0 items-center gap-1.5" title="A run that takes longer than this is stopped">Time limit
          <select value={timeoutMs} onChange={(e) => set({ timeoutMs: Number(e.target.value) })}
                  className="h-7 rounded-md border border-line bg-white px-1.5 text-[12px] text-ink">
            {/* A value saved by hand or by an older version still shows, rather than the picker lying. */}
            {!TIME_LIMITS.some(([ms]) => ms === timeoutMs) && <option value={timeoutMs}>{Math.round(timeoutMs / 1000).toLocaleString()} s</option>}
            {TIME_LIMITS.map(([ms, label]) => <option key={ms} value={ms}>{label}</option>)}
          </select>
        </label>
      </div>
    </div>
  )
}
