import { Copy, MoreHorizontal, Pencil, Pin, PinOff, Star, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { type SavedQuery, useStore, varCount } from '@/store'
import { Menu, MenuContent, MenuItem, MenuLabel, MenuSeparator, MenuTrigger } from '@/ui/dialog'
import { Pill } from '@/ui/input'
import { row } from './styles'

export function QueryRow({ query, indent }: { query: SavedQuery; indent?: boolean }) {
  const active = useStore((s) => s.tabs.find((t) => t.id === s.activeTabId)?.queryId === query.id)
  const folders = useStore((s) => s.folders)
  const { openQuery, updateQuery, duplicateQuery, deleteQuery, setDialog } = useStore.getState()
  const vars = varCount(query.sql)
  return (
    <div draggable onDragStart={(e) => e.dataTransfer.setData('text/quarry-query', query.id)}
         className={cn(row, indent && 'pl-6', active && 'bg-mint font-medium text-brand hover:bg-mint')}>
      <button className="flex h-full min-w-0 flex-1 items-center gap-2 text-left" onClick={() => openQuery(query.id)} title={query.sql}>
        {query.pinned && !indent && <Star className="size-3 shrink-0 fill-amber-500 text-amber-500" />}
        <span className="truncate">{query.name}</span>
      </button>
      {vars > 0 && <Pill className="shrink-0 bg-var-bg px-1.5 py-0 text-[10px] text-var-ink">{vars} var{vars > 1 ? 's' : ''}</Pill>}
      <Menu>
        <MenuTrigger aria-label={`Actions for ${query.name}`} className="shrink-0 rounded p-0.5 opacity-0 hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
          <MoreHorizontal className="size-3.5" />
        </MenuTrigger>
        <MenuContent>
          <MenuItem onSelect={() => setDialog({ kind: 'details', queryId: query.id })}><Pencil />Rename, tags, folder…</MenuItem>
          <MenuItem onSelect={() => updateQuery(query.id, { pinned: !query.pinned })}>{query.pinned ? <><PinOff />Unpin</> : <><Pin />Pin to top</>}</MenuItem>
          <MenuItem onSelect={() => duplicateQuery(query.id)}><Copy />Duplicate</MenuItem>
          {folders.length > 0 && <MenuSeparator />}
          {folders.length > 0 && <MenuLabel>Move to</MenuLabel>}
          {folders.filter((f) => f.id !== query.folderId).map((f) => (
            <MenuItem key={f.id} onSelect={() => updateQuery(query.id, { folderId: f.id })}>{f.name}</MenuItem>
          ))}
          {query.folderId && <MenuItem onSelect={() => updateQuery(query.id, { folderId: null })}>No folder</MenuItem>}
          <MenuSeparator />
          <MenuItem danger onSelect={() => setDialog({
            kind: 'confirm', danger: true, action: 'Delete', title: `Delete "${query.name}"?`,
            body: 'The saved query is removed from the library. This cannot be undone.', onConfirm: () => deleteQuery(query.id),
          })}><Trash2 />Delete</MenuItem>
        </MenuContent>
      </Menu>
    </div>
  )
}
