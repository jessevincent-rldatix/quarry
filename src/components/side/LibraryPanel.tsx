import { ChevronDown, ChevronRight, FolderPlus, MoreHorizontal, Pencil, Plus, Trash2 } from 'lucide-react'
import { useMemo, useState } from 'react'
import { cn, matches } from '@/lib/utils'
import { type SavedQuery, useStore } from '@/store'
import { Button } from '@/ui/button'
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/ui/dialog'
import { SectionLabel } from '@/ui/input'
import { QueryRow } from './QueryRow'
import { filterInput, row } from './styles'

export function LibraryPanel() {
  const folders = useStore((s) => s.folders)
  const queries = useStore((s) => s.queries)
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState('')
  const [dropTarget, setDropTarget] = useState('')
  const [received, setReceived] = useState('')
  const { newTab, addFolder, updateFolder, deleteFolder, updateQuery, setDialog } = useStore.getState()

  const tags = useMemo(() => [...new Set(queries.flatMap((q) => q.tags))].sort(), [queries])
  const filtering = search.trim() !== '' || tag !== ''
  const visible = queries.filter((q) =>
    (!tag || q.tags.includes(tag)) && matches(`${q.name} ${q.sql} ${q.tags.map((t) => `#${t}`).join(' ')}`, search))
  const byName = (a: SavedQuery, b: SavedQuery) => a.name.localeCompare(b.name)
  const unfiled = visible.filter((q) => !q.folderId || !folders.some((f) => f.id === q.folderId)).sort(byName)
  const pinned = visible.filter((q) => q.pinned).sort(byName)

  const dropProps = (folderId: string | null) => ({
    onDragOver: (e: React.DragEvent) => { if (e.dataTransfer.types.includes('text/quarry-query')) { e.preventDefault(); setDropTarget(folderId ?? 'none') } },
    onDragLeave: () => setDropTarget(''),
    onDrop: (e: React.DragEvent) => {
      const id = e.dataTransfer.getData('text/quarry-query')
      if (id) {
        updateQuery(id, { folderId })
        setReceived(folderId ?? 'none')
        setTimeout(() => setReceived(''), 1600)
      }
      setDropTarget('')
    },
  })

  return (
    <>
      <div className="flex items-center gap-1">
        <SectionLabel className="flex-1">Library</SectionLabel>
        <Button variant="ghost" size="xs" onClick={() => setDialog({ kind: 'prompt', title: 'New folder', label: 'Folder name', value: '', onSubmit: (name) => { addFolder(name) } })}>
          <FolderPlus className="size-3.5" />Folder
        </Button>
        <Button size="xs" onClick={() => newTab()}><Plus className="size-3.5" />Query</Button>
      </div>
      <input className={filterInput} value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Filter by name, SQL or #tag" aria-label="Filter saved queries" />

      <div className="scrollbars-visible -mx-1 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto px-1">
        {pinned.length > 0 && (
          <div className="flex flex-col gap-px">
            <SectionLabel className="px-1.5 py-1">Pinned</SectionLabel>
            {pinned.map((q) => <QueryRow key={q.id} query={q} />)}
          </div>
        )}

        <div className="flex flex-col gap-px">
          <SectionLabel className="px-1.5 py-1">Folders</SectionLabel>
          {folders.map((folder) => {
            const inside = visible.filter((q) => q.folderId === folder.id).sort(byName)
            if (filtering && inside.length === 0) return null
            const open = folder.open || filtering
            return (
              <div key={folder.id} {...dropProps(folder.id)} className={cn('rounded-md transition-colors', dropTarget === folder.id && 'bg-mint/60', received === folder.id && 'bg-accent/20')}>
                <div className={cn(row, 'font-semibold')}>
                  <button className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={open} onClick={() => updateFolder(folder.id, { open: !folder.open })}>
                    {open ? <ChevronDown className="size-3.5 shrink-0 text-ink-mute" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-mute" />}
                    <span className="truncate">{folder.name}</span>
                  </button>
                  <span className={cn('text-[11px] font-normal text-ink-mute', received === folder.id && 'font-medium text-accent-deep')} aria-live="polite">
                    {received === folder.id ? 'Moved here' : inside.length}
                  </span>
                  <Menu>
                    <MenuTrigger aria-label={`Actions for folder ${folder.name}`} className="shrink-0 rounded p-0.5 opacity-0 hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100">
                      <MoreHorizontal className="size-3.5" />
                    </MenuTrigger>
                    <MenuContent>
                      <MenuItem onSelect={() => setDialog({ kind: 'prompt', title: 'Rename folder', label: 'Folder name', value: folder.name, onSubmit: (name) => updateFolder(folder.id, { name }) })}><Pencil />Rename</MenuItem>
                      <MenuItem danger onSelect={() => setDialog({
                        kind: 'confirm', danger: true, action: 'Delete folder', title: `Delete folder "${folder.name}"?`,
                        body: 'Its queries are kept and move to "No folder".', onConfirm: () => deleteFolder(folder.id),
                      })}><Trash2 />Delete folder</MenuItem>
                    </MenuContent>
                  </Menu>
                </div>
                {open && inside.map((q) => <QueryRow key={q.id} query={q} indent />)}
                {open && inside.length === 0 && <div className="py-1 pl-6 text-[12px] text-ink-mute">Empty. Drag a query here.</div>}
              </div>
            )
          })}
          {(unfiled.length > 0 || dropTarget === 'none') && (
            <div {...dropProps(null)} className={cn('rounded-md', dropTarget === 'none' && 'bg-mint/60')}>
              <div className="px-1.5 py-1 text-[12px] text-ink-mute">No folder</div>
              {unfiled.map((q) => <QueryRow key={q.id} query={q} indent />)}
            </div>
          )}
          {visible.length === 0 && <div className="px-1.5 py-2 text-[12.5px] text-ink-mute">{filtering ? 'No saved query matches.' : 'Nothing saved yet. Write a query and press Save.'}</div>}
        </div>

        {tags.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <SectionLabel className="px-1.5 py-1">Tags</SectionLabel>
            <div className="flex flex-wrap gap-1.5 px-1.5">
              {tags.map((t) => (
                <button key={t} aria-pressed={tag === t} onClick={() => setTag(tag === t ? '' : t)}
                        className={cn('rounded-full px-2 py-0.5 text-[11px] font-medium', tag === t ? 'bg-brand text-white' : 'bg-panel-header text-ink hover:bg-mint')}>
                  #{t}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </>
  )
}
