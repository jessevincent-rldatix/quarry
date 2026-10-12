import { RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { groupBySchema } from '@/lib/schema'
import { tableKey } from '@/lib/sqlBuilder'
import { cn, matches } from '@/lib/utils'
import { useStore, useTables } from '@/store'
import { Button } from '@/ui/button'
import { SectionLabel } from '@/ui/input'
import { SchemaGroup } from './SchemaGroup'
import { TableNode } from './TableNode'
import { filterInput } from './styles'

const CLOSED_KEY = 'quarry.schema.closed'
const MAX_SHOWN = 400

/** The schemas folded shut, remembered per connection as "connection:schema". */
function readClosed(): Set<string> {
  try { return new Set(JSON.parse(localStorage.getItem(CLOSED_KEY) ?? '[]') as string[]) } catch { return new Set() }
}

export function SchemaPanel() {
  const tables = useTables()
  const connectionId = useStore((s) => s.activeConnectionId)
  const status = useStore((s) => s.schemas[connectionId])
  const [search, setSearch] = useState('')
  const [closed, setClosed] = useState(readClosed)
  const searching = search.trim() !== ''
  const shown = searching
    ? tables.filter((t) => matches(tableKey(t), search) || t.columns.some((c) => matches(c.name, search)))
    : tables
  const groups = groupBySchema(shown.slice(0, MAX_SHOWN))
  const forceOpen = search.trim().length > 1 && shown.length <= 12

  const toggle = (schema: string) => {
    const key = `${connectionId}:${schema}`
    const next = new Set(closed)
    if (!next.delete(key)) next.add(key)
    setClosed(next)
    try { localStorage.setItem(CLOSED_KEY, JSON.stringify([...next])) } catch { /* not remembered */ }
  }

  return (
    <>
      <div className="flex items-center gap-1">
        <SectionLabel className="flex-1">Schema</SectionLabel>
        <Button variant="ghost" size="xs" onClick={() => void useStore.getState().loadSchema(connectionId, true)}>
          <RefreshCw className={cn('size-3.5', status?.loading && 'animate-spin')} />Refresh
        </Button>
      </div>
      <input className={filterInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tables and columns" aria-label="Search tables and columns" />
      <div className="scrollbars-visible -mx-1 flex min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1">
        {status?.error && <div className="rounded-md border border-red-200 bg-red-50 p-2 text-[12px] text-red-800">{status.error}</div>}
        {status?.loading && tables.length === 0 && <div className="px-1.5 py-2 text-ink-mute">Reading the schema…</div>}
        {groups.map((group) => {
          const nodes = group.tables.map((t) => <TableNode key={`${t.schema}.${t.name}`} table={t} forceOpen={forceOpen} search={search} bare={group.schema !== ''} />)
          // Tables with no schema to their name, and a database with only one, need no heading.
          if (group.schema === '' || groups.length === 1) return nodes
          // A search shows what it found, whatever is folded shut.
          return (
            <SchemaGroup key={group.schema} name={group.schema} count={group.tables.length} open={searching || !closed.has(`${connectionId}:${group.schema}`)} onToggle={() => toggle(group.schema)}>
              {nodes}
            </SchemaGroup>
          )
        })}
        {shown.length > MAX_SHOWN && <div className="px-1.5 py-2 text-[12px] text-ink-mute">Showing {MAX_SHOWN} of {shown.length} tables. Search to narrow it down.</div>}
        {!status?.loading && !status?.error && shown.length === 0 && <div className="px-1.5 py-2 text-ink-mute">{tables.length ? 'No table or column matches.' : 'No tables found.'}</div>}
      </div>
    </>
  )
}
