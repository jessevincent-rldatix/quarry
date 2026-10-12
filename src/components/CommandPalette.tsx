import { useEffect, useMemo, useRef, useState } from 'react'
import { Blocks, Cable, Columns3, FileStack, Gauge, FileText, History, Plus, Search, Sparkles, Table2, Workflow, X } from 'lucide-react'
import { BUILTIN_TEMPLATES, templateSql } from '@/lib/builtins'
import { ident, previewSql, tableKey, tableRef } from '@/lib/sqlBuilder'
import { parseVars } from '@/lib/template'
import { cn, kbd, matches } from '@/lib/utils'
import { useSemanticMatches } from '@/hooks/useSemanticMatches'
import { useDialect, useStore, useTables } from '@/store'
import { SectionLabel } from '@/ui/input'
import { editorBridge } from './editor/editorBridge'

interface Entry {
  id: string
  group: 'Saved queries' | 'Tables and columns' | 'Related by meaning' | 'Templates' | 'Commands'
  label: string
  hint: string
  icon: React.ReactNode
  /** Extra text searched but not shown, such as the SQL of a saved query. */
  body?: string
  run: () => void
  /** Ctrl+Enter: open and run straight away. */
  runNow?: () => void
}

const GROUPS: Entry['group'][] = ['Saved queries', 'Tables and columns', 'Related by meaning', 'Templates', 'Commands']

export function CommandPalette() {
  const open = useStore((s) => s.paletteOpen)
  const queries = useStore((s) => s.queries)
  const folders = useStore((s) => s.folders)
  const myTemplates = useStore((s) => s.templates)
  const tables = useTables()
  const dialect = useDialect()
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState(0)
  const list = useRef<HTMLDivElement>(null)
  const related = useSemanticMatches(search, open)
  const close = () => useStore.getState().set({ paletteOpen: false })

  useEffect(() => { if (open) { setSearch(''); setSelected(0) } }, [open])

  const entries = useMemo<Entry[]>(() => {
    const store = useStore.getState()
    const out: Entry[] = []
    for (const q of queries) {
      const folder = folders.find((f) => f.id === q.folderId)?.name
      out.push({
        id: `q:${q.id}`, group: 'Saved queries', label: q.name, body: q.sql, icon: <FileText className="size-4 text-accent" />,
        hint: [folder, ...q.tags.map((t) => `#${t}`)].filter(Boolean).join(' · '),
        run: () => store.openQuery(q.id),
        runNow: () => { store.openQuery(q.id); void store.runTab(useStore.getState().activeTabId) },
      })
    }
    for (const t of tables) {
      const key = tableKey(t)
      out.push({
        id: `t:${key}`, group: 'Tables and columns', label: key, hint: `${t.kind} · ${t.columns.length} columns`, icon: <Table2 className="size-4 text-[#8b5cf6]" />,
        run: () => { store.set({ view: 'editor' }); editorBridge.current?.insert(tableRef(t, dialect)) },
        runNow: () => void store.runTab(store.openSql({ title: t.name, sql: previewSql(t, dialect), connectionId: store.activeConnectionId })),
      })
      for (const c of t.columns) {
        out.push({
          id: `c:${key}.${c.name}`, group: 'Tables and columns', label: `${key}.${c.name}`, hint: `column · ${c.type.toLowerCase()}`, icon: <Columns3 className="size-4 text-[#8b5cf6]" />,
          run: () => { store.set({ view: 'editor' }); editorBridge.current?.insert(ident(c.name, dialect)) },
        })
      }
    }
    for (const template of [...BUILTIN_TEMPLATES, ...myTemplates]) {
      const sql = templateSql(template, dialect, tables)
      if (!sql) continue
      const count = parseVars(sql, dialect).length
      out.push({
        id: `tpl:${template.id}`, group: 'Templates', label: template.name, body: template.description, icon: <FileStack className="size-4 text-amber-500" />,
        hint: count ? `${count} variable${count > 1 ? 's' : ''}` : template.category,
        run: () => store.openSql({ title: template.name, sql, connectionId: store.activeConnectionId }),
      })
    }
    const command = (id: string, label: string, hint: string, icon: React.ReactNode, run: () => void) =>
      out.push({ id: `cmd:${id}`, group: 'Commands', label, hint, icon, run })
    command('new', 'New query tab', 'Alt N', <Plus className="size-4" />, () => store.newTab())
    command('close-all', 'Close all tabs', 'Alt Shift W', <X className="size-4" />, () => store.closeTabs(store.tabs.map((t) => t.id)))
    command('close-others', 'Close the other tabs', '', <X className="size-4" />, () => store.closeTabs(store.tabs.filter((t) => t.id !== store.activeTabId).map((t) => t.id)))
    command('builder', 'Open query builder', '', <Blocks className="size-4" />, () => store.set({ view: 'builder' }))
    command('map', 'Open schema map', '', <Workflow className="size-4" />, () => store.set({ view: 'map' }))
    command('profiler', 'Open profiler', '', <Gauge className="size-4" />, () => store.set({ view: 'profiler' }))
    command('ask', 'Ask a question', kbd('I'), <Sparkles className="size-4" />, () => store.set({ askOpen: true }))
    command('templates', 'Browse templates', '', <FileStack className="size-4" />, () => store.set({ view: 'templates' }))
    command('library', 'Show library', '', <FileText className="size-4" />, () => store.set({ view: 'editor', panel: 'library' }))
    command('schema', 'Show schema', '', <Table2 className="size-4" />, () => store.set({ view: 'editor', panel: 'schema' }))
    command('history', 'Show run history', '', <History className="size-4" />, () => store.set({ view: 'editor', panel: 'history' }))
    command('connections', 'Manage connections', '', <Cable className="size-4" />, () => store.setDialog({ kind: 'connections' }))
    for (const c of store.connections) {
      command(`use:${c.id}`, `Switch to ${c.name}`, c.dialect, <Cable className="size-4" />, () => store.setConnection(c.id))
    }
    return out
  }, [queries, folders, myTemplates, tables, dialect, open])

  const found = useMemo(() => {
    const term = search.trim()
    // Columns would swamp the list, so they only show once the user has typed something.
    const pool = term ? entries.filter((e) => matches(`${e.label} ${e.hint} ${e.body ?? ''}`, term)) : entries.filter((e) => !e.id.startsWith('c:'))
    const rank = (e: Entry) => (e.label.toLowerCase().startsWith(term.toLowerCase()) ? 0 : matches(e.label, term) ? 1 : 2)
    // Tables and columns the index relates to the phrase, beyond those whose names already matched.
    const byWords = new Set(pool.map((e) => e.id))
    const byId = new Map(entries.map((e) => [e.id, e]))
    for (const m of related) {
      const table = tables.find((t) => t.schema === m.schema && t.name === m.table)
      const entry = table && byId.get(m.column ? `c:${tableKey(table)}.${m.column}` : `t:${tableKey(table)}`)
      if (entry && !byWords.has(entry.id)) pool.push({ ...entry, id: `m:${entry.id}`, group: 'Related by meaning', icon: <Sparkles className="size-4 text-accent-deep" /> })
    }
    const limit = term ? 8 : 6
    const shown: Entry[] = []
    const more = new Map<string, number>()
    for (const group of GROUPS) {
      const inGroup = pool.filter((e) => e.group === group)
      // Related entries arrive ranked by the index; the rest are ranked by how the name matches.
      if (group !== 'Related by meaning') inGroup.sort((a, b) => rank(a) - rank(b))
      const kept = inGroup.slice(0, limit)
      shown.push(...kept)
      if (kept.length && inGroup.length > kept.length) more.set(kept[kept.length - 1].id, inGroup.length - kept.length)
    }
    return { shown, more }
  }, [entries, search, related, tables])
  const filtered = found.shown

  useEffect(() => {
    list.current?.querySelector(`[data-index="${selected}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [selected])

  if (!open) return null

  const choose = (entry: Entry | undefined, now: boolean) => {
    if (!entry) return
    close()
    if (now && entry.runNow) entry.runNow()
    else entry.run()
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowDown') { event.preventDefault(); setSelected((s) => Math.min(s + 1, filtered.length - 1)) }
    else if (event.key === 'ArrowUp') { event.preventDefault(); setSelected((s) => Math.max(s - 1, 0)) }
    else if (event.key === 'Enter') { event.preventDefault(); choose(filtered[selected], event.ctrlKey || event.metaKey) }
    else if (event.key === 'Escape') { event.preventDefault(); close() }
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-start justify-center bg-[rgba(15,61,56,0.25)] pt-[12vh]" onClick={close}>
      <div role="dialog" aria-label="Search and commands" className="w-[560px] max-w-[92vw] overflow-hidden rounded-xl border border-line bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-2 border-b border-line-soft px-3 py-2.5">
          <Search className="size-4 text-ink-mute" />
          <input autoFocus value={search} onChange={(e) => { setSearch(e.target.value); setSelected(0) }} onKeyDown={onKeyDown}
                 placeholder="Go to a saved query, table, column or template, or run a command…" aria-label="Search"
                 className="flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-gray-400" />
          <kbd className="rounded bg-panel px-1.5 py-0.5 text-[10px] text-ink-mute">Esc</kbd>
        </div>
        <div ref={list} className="scrollbars-visible max-h-[50vh] overflow-y-auto py-1">
          {filtered.length === 0 && <div className="px-4 py-6 text-center text-[12.5px] text-ink-mute">No matches</div>}
          {filtered.map((entry, i) => (
            <div key={entry.id}>
              {(i === 0 || filtered[i - 1].group !== entry.group) && <SectionLabel className="px-3 pb-1 pt-2">{entry.group}</SectionLabel>}
              <button data-index={i} onMouseEnter={() => setSelected(i)} onClick={(e) => choose(entry, e.ctrlKey || e.metaKey)}
                      className={cn('flex w-full items-center gap-3 px-3 py-2 text-left', i === selected && 'bg-panel')}>
                <span className="shrink-0 text-ink-mute">{entry.icon}</span>
                <span className="min-w-0 flex-1 truncate text-[13px]">{entry.label}</span>
                <span className="shrink-0 text-[11px] text-ink-mute">{entry.hint}</span>
              </button>
              {found.more.has(entry.id) && (
                <div className="px-3 pb-1 pl-10 text-[11px] text-ink-mute">and {found.more.get(entry.id)!.toLocaleString()} more. Keep typing to narrow them down.</div>
              )}
            </div>
          ))}
        </div>
        <div className="flex flex-wrap gap-x-4 border-t border-line-soft bg-panel px-3 py-1.5 text-[11px] text-ink-mute">
          <span>Enter to open or insert</span><span>{kbd('Enter')} to open and run</span><span>↑ ↓ to move</span>
        </div>
      </div>
    </div>
  )
}
