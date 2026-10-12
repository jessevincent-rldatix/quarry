import { Trash2 } from 'lucide-react'
import { useState } from 'react'
import { matches, timeAgo } from '@/lib/utils'
import { useStore } from '@/store'
import { Button } from '@/ui/button'
import { Pill, SectionLabel } from '@/ui/input'
import { filterInput } from './styles'

export function HistoryPanel() {
  const history = useStore((s) => s.history)
  const [search, setSearch] = useState('')
  const shown = history.filter((h) => matches(`${h.sql} ${h.connection} ${h.error ?? ''}`, search))
  const { openSql, clearHistory, setDialog } = useStore.getState()
  // A past run reopens on the connection it ran on; one whose connection is gone falls back to the current one.
  const reopen = (sql: string, connectionId?: string) => openSql({ sql, connectionId: connectionId ?? useStore.getState().activeConnectionId })
  return (
    <>
      <div className="flex items-center gap-1">
        <SectionLabel className="flex-1">History</SectionLabel>
        {history.length > 0 && (
          <Button variant="ghost" size="xs" onClick={() => setDialog({
            kind: 'confirm', danger: true, action: 'Clear history', title: 'Clear run history?',
            body: `${history.length} entries are removed. Saved queries are not affected.`, onConfirm: clearHistory,
          })}><Trash2 className="size-3.5" />Clear</Button>
        )}
      </div>
      <input className={filterInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search past runs and errors" aria-label="Search past runs" />
      <div className="scrollbars-visible -mx-1 flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-1">
        {shown.slice(0, 200).map((item) => (
          <button key={item.id} onClick={() => reopen(item.sql, item.connectionId)} title={`Open in a new tab on ${item.connection}`}
                  className="flex flex-col gap-0.5 rounded-md px-1.5 py-1.5 text-left hover:bg-mint-hover/40">
            <span className="line-clamp-2 break-all font-mono text-[11.5px]">{item.sql.replace(/\s+/g, ' ')}</span>
            {item.error && <span className="line-clamp-2 break-words text-[11.5px] text-red-800">{item.error}</span>}
            <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-mute">
              {item.error ? <Pill className="bg-red-100 px-1.5 py-0 text-red-800">failed</Pill>
                : item.stopped ? <span><Pill className="bg-panel-header px-1.5 py-0 text-ink-mute">stopped</Pill> · {item.ms} ms</span>
                : <span>{item.rows === null ? 'done' : `${item.rows.toLocaleString()} rows`} · {item.ms} ms</span>}
              <span>{item.connection}</span>
              <span className="ml-auto">{timeAgo(item.at)}</span>
            </span>
          </button>
        ))}
        {shown.length === 0 && <div className="px-1.5 py-2 text-ink-mute">{history.length ? 'No past run matches.' : 'Every query you run is listed here.'}</div>}
      </div>
    </>
  )
}
