import { useMemo, useState } from 'react'
import { ClipboardCopy, Play, Plus, SquarePen, X } from 'lucide-react'
import { valueKind } from '@shared/dialect'
import {
  OPERATORS, buildQuery, columnRef, emptyBuilder, isRelated, refColumn, refTable, suggestJoin, tableKey, tidyBuilder,
  type BuilderJoin, type BuilderState, type OperatorId,
} from '@/lib/sqlBuilder'
import { cn, matches, uid } from '@/lib/utils'
import { useDialect, useStore, useTables } from '@/store'
import { Button } from '@/ui/button'
import { Input, SectionLabel, Select } from '@/ui/input'

const card = 'flex flex-col gap-2 rounded-[10px] border border-gray-200 bg-white p-3.5'

const VALUE_HINT = { bool: 'true or false', date: 'YYYY-MM-DD', datetime: 'YYYY-MM-DD', number: 'a number', text: 'value', other: 'value' } as const

export function BuilderView() {
  const tables = useTables()
  const dialect = useDialect()
  // Kept in the store so the half-built query is still here after a trip to the editor.
  const state = useStore((s) => s.builder)
  // Every change is tidied, so nothing is left pointing at a table or grouping that has gone.
  const setState = (next: (s: BuilderState) => BuilderState) => useStore.getState().set({ builder: tidyBuilder(next(useStore.getState().builder), tables) })
  const [search, setSearch] = useState('')
  const [copied, setCopied] = useState(false)
  const patch = (change: Partial<BuilderState>) => setState((s) => ({ ...s, ...change }))

  const byKey = useMemo(() => new Map(tables.map((t) => [tableKey(t), t])), [tables])
  const base = byKey.get(state.table)
  const inQuery = useMemo(() => [state.table, ...state.joins.map((j) => j.table)].flatMap((key) => byKey.get(key) ?? []), [state.table, state.joins, byKey])
  // Every column the query can refer to, as "table.column".
  const refs = useMemo(() => inQuery.flatMap((t) => t.columns.map((c) => columnRef(tableKey(t), c.name))), [inQuery])
  const label = (ref: string) => (state.joins.length ? `${refTable(ref)}.${refColumn(ref)}` : refColumn(ref))
  const typeOf = (ref: string) => byKey.get(refTable(ref))?.columns.find((c) => c.name === refColumn(ref))?.type ?? ''
  const { sql, problems } = buildQuery(state, tables, dialect)

  const pickTable = (key: string) => setState(() => ({ ...emptyBuilder(), table: key }))
  const addJoin = (key: string) => {
    const other = byKey.get(key)
    if (!other) return
    const guess = suggestJoin(inQuery, other)
    setState((s) => ({ ...s, joins: [...s.joins, { id: uid(), table: key, from: guess?.from ?? '', to: guess?.to ?? '' }] }))
  }
  const changeJoin = (id: string, change: Partial<BuilderJoin>) => setState((s) => ({ ...s, joins: s.joins.map((j) => (j.id === id ? { ...j, ...change } : j)) }))
  const toggleColumn = (ref: string) =>
    patch({ columns: state.columns.includes(ref) ? state.columns.filter((c) => c !== ref) : [...state.columns, ref] })

  const open = (run: boolean) => {
    const { openSql, runTab, activeConnectionId } = useStore.getState()
    const id = openSql({ sql, title: base ? `${base.name} query` : undefined, connectionId: activeConnectionId })
    if (run) void runTab(id)
  }

  const shownTables = tables.filter((t) => matches(tableKey(t), search) || t.columns.some((c) => matches(c.name, search)))
  const joinable = tables.filter((t) => !inQuery.includes(t))
  const related = joinable.filter((t) => isRelated(inQuery, t))
  const unrelated = joinable.filter((t) => !related.includes(t))

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-wrap overflow-y-auto bg-editor xl:flex-nowrap xl:overflow-hidden">
      <aside className="flex w-full shrink-0 flex-col gap-2 border-r border-line bg-panel p-2.5 md:w-[260px]" aria-label="Tables">
        <SectionLabel className="px-1.5 py-1">Start from a table</SectionLabel>
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search tables and columns" aria-label="Search tables and columns"
               className="h-8 w-full rounded-md border border-line bg-white px-2.5 text-[12.5px] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand" />
        <div className="scrollbars-visible -mx-1 flex max-h-[40vh] min-h-0 flex-1 flex-col gap-px overflow-y-auto px-1 xl:max-h-none">
          {shownTables.slice(0, 300).map((t) => {
            const key = tableKey(t)
            const active = key === state.table
            return (
              <div key={key}>
                <button onClick={() => pickTable(key)} aria-pressed={active}
                        className={cn('flex h-7 w-full items-center gap-2 rounded-md px-1.5 text-left text-[12.5px] hover:bg-mint-hover/40', active && 'bg-mint font-medium text-brand hover:bg-mint')}>
                  <span className="min-w-0 flex-1 truncate">{key}</span>
                  <span className="text-[11px] font-normal text-ink-mute">{t.columns.length} cols</span>
                </button>
                {active && t.columns.map((c) => {
                  const ref = columnRef(key, c.name)
                  return (
                    <label key={c.name} className="flex min-h-7 items-center gap-2 pl-5 pr-1.5 font-mono text-[12px]">
                      <input type="checkbox" className="accent-brand" checked={state.columns.includes(ref)} onChange={() => toggleColumn(ref)} />
                      <span className="min-w-0 flex-1 truncate">{c.name}</span>
                      <span className="font-sans text-[11px] text-ink-mute">{c.type.toLowerCase()}</span>
                    </label>
                  )
                })}
              </div>
            )
          })}
          {tables.length === 0 && <div className="px-1.5 py-2 text-ink-mute">No tables found on this connection.</div>}
        </div>
      </aside>

      <main className="scrollbars-visible flex min-w-0 flex-1 basis-[440px] flex-col gap-4 p-5 xl:overflow-y-auto">
        <div>
          <h1 className="text-[18px] font-semibold text-brand">Query builder</h1>
          <p className="text-ink-mute">Build a SELECT by picking, not typing. The SQL updates as you go. No columns ticked means all columns.</p>
        </div>

        {!base ? (
          <div className="rounded-[10px] border border-dashed border-line p-8 text-center text-ink-mute">Pick a table on the left to start.</div>
        ) : (
          <>
            <section className={card}>
              <SectionLabel>From</SectionLabel>
              <div><span className="rounded-md bg-mint px-2.5 py-1.5 font-medium text-brand">{state.table}</span></div>
              {state.joins.map((join) => {
                const joined = byKey.get(join.table)
                if (!joined) return null
                // A join can hang off the starting table or any table joined above it.
                const earlier = inQuery.slice(0, inQuery.indexOf(joined))
                return (
                  <div key={join.id} className="flex flex-col gap-2 border-t border-line-soft pt-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-ink-mute">joined to</span>
                      <span className="rounded-md bg-mint px-2.5 py-1.5 font-medium text-brand">{join.table}</span>
                      <span className="text-ink-mute">where</span>
                      <Select className="w-auto" aria-label={`Column that ${join.table} joins to`} value={join.from} onChange={(e) => changeJoin(join.id, { from: e.target.value })}>
                        <option value="">Pick a column</option>
                        {earlier.flatMap((t) => t.columns.map((c) => {
                          const ref = columnRef(tableKey(t), c.name)
                          return <option key={ref} value={ref}>{t.name}.{c.name}</option>
                        }))}
                      </Select>
                      <span className="text-ink-mute">=</span>
                      <Select className="w-auto" aria-label={`${join.table} column`} value={join.to} onChange={(e) => changeJoin(join.id, { to: e.target.value })}>
                        <option value="">Pick a column</option>
                        {joined.columns.map((c) => <option key={c.name} value={c.name}>{joined.name}.{c.name}</option>)}
                      </Select>
                      <Button variant="ghost" size="icon-sm" aria-label={`Remove the join to ${join.table}`} onClick={() => setState((s) => ({ ...s, joins: s.joins.filter((j) => j.id !== join.id) }))}>
                        <X className="size-4" />
                      </Button>
                    </div>
                    <div className="flex flex-wrap gap-x-4 gap-y-1">
                      {joined.columns.map((c) => {
                        const ref = columnRef(join.table, c.name)
                        return (
                          <label key={c.name} className="flex min-h-7 items-center gap-1.5 font-mono text-[12px]">
                            <input type="checkbox" className="accent-brand" checked={state.columns.includes(ref)} onChange={() => toggleColumn(ref)} />
                            {joined.name}.{c.name}
                          </label>
                        )
                      })}
                    </div>
                  </div>
                )
              })}
              {joinable.length > 0 && (
                <div className="flex flex-wrap items-center gap-2 border-t border-line-soft pt-2">
                  <span className="text-ink-mute">{state.joins.length ? 'and joined to' : 'joined to'}</span>
                  {/* Always shows the prompt: picking a table adds a join row above. */}
                  <Select className="w-auto" aria-label="Add a joined table" value="" onChange={(e) => addJoin(e.target.value)}>
                    <option value="">{state.joins.length ? 'Another table' : 'Nothing'}</option>
                    {related.length > 0 && <optgroup label="Linked by a foreign key">{related.map((t) => <option key={tableKey(t)}>{tableKey(t)}</option>)}</optgroup>}
                    <optgroup label={related.length ? 'Other tables' : 'Tables'}>{unrelated.map((t) => <option key={tableKey(t)}>{tableKey(t)}</option>)}</optgroup>
                  </Select>
                </div>
              )}
            </section>

            <section className={card}>
              <SectionLabel>Where</SectionLabel>
              {state.filters.map((f, i) => {
                const update = (change: Partial<typeof f>) => patch({ filters: state.filters.map((x) => (x.id === f.id ? { ...x, ...change } : x)) })
                const needsValue = f.op !== 'null' && f.op !== 'notnull'
                return (
                  <div key={f.id} className="flex flex-wrap items-center gap-2">
                    <span className="w-7 text-[12px] text-ink-mute">{i === 0 ? '' : 'and'}</span>
                    <Select className="w-auto" aria-label="Column" value={f.column} onChange={(e) => update({ column: e.target.value })}>
                      {refs.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                    </Select>
                    <Select className="w-auto" aria-label="Condition" value={f.op} onChange={(e) => update({ op: e.target.value as OperatorId })}>
                      {OPERATORS.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
                    </Select>
                    {needsValue && (
                      <Input className="min-w-[140px] flex-1" aria-label="Value" value={f.value} onChange={(e) => update({ value: e.target.value })}
                             placeholder={f.op === 'in' ? 'a, b, c' : f.op === 'contains' || f.op === 'starts' ? 'value' : VALUE_HINT[valueKind(typeOf(f.column))]} />
                    )}
                    <Button variant="ghost" size="icon-sm" aria-label="Remove filter" onClick={() => patch({ filters: state.filters.filter((x) => x.id !== f.id) })}><X className="size-4" /></Button>
                  </div>
                )
              })}
              <div>
                <Button variant="ghost" size="xs" className="text-accent-deep" onClick={() => patch({ filters: [...state.filters, { id: uid(), column: refs[0], op: 'eq', value: '' }] })}>
                  <Plus className="size-3.5" />Add filter
                </Button>
              </div>
            </section>

            <section className={cn(card, 'flex-row flex-wrap gap-5')}>
              <label className="flex flex-col gap-1.5"><SectionLabel>Count rows by</SectionLabel>
                <Select className="w-auto" value={state.groupBy} onChange={(e) => patch({ groupBy: e.target.value })}>
                  <option value="">No grouping</option>
                  {refs.map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </Select>
              </label>
              <label className="flex flex-col gap-1.5"><SectionLabel>Sort by</SectionLabel>
                <Select className="w-auto" value={state.sortBy} onChange={(e) => patch({ sortBy: e.target.value })}>
                  <option value="">{state.groupBy ? 'Largest count first' : 'No sorting'}</option>
                  {(state.groupBy ? [state.groupBy] : refs).map((r) => <option key={r} value={r}>{label(r)}</option>)}
                </Select>
              </label>
              {state.sortBy && (
                <label className="flex flex-col gap-1.5"><SectionLabel>Direction</SectionLabel>
                  <Select className="w-auto" value={state.sortDesc ? 'desc' : 'asc'} onChange={(e) => patch({ sortDesc: e.target.value === 'desc' })}>
                    <option value="asc">Smallest or oldest first</option>
                    <option value="desc">Largest or newest first</option>
                  </Select>
                </label>
              )}
              <label className="flex flex-col gap-1.5"><SectionLabel>Limit</SectionLabel>
                <Input className="w-24" inputMode="numeric" value={state.limit} placeholder="none" onChange={(e) => patch({ limit: e.target.value })} />
              </label>
            </section>
          </>
        )}
      </main>

      <aside className="flex w-full shrink-0 flex-col gap-3 border-l border-line bg-white p-5 xl:w-[400px] xl:overflow-y-auto" aria-label="Generated SQL">
        <SectionLabel>Generated SQL</SectionLabel>
        <pre className="scrollbars-visible min-h-[120px] overflow-x-auto rounded-lg border border-line-soft bg-editor p-3 font-mono text-[12.5px] leading-5">
          {sql || <span className="font-sans text-ink-mute">The query appears here.</span>}
        </pre>
        {problems.length > 0 && (
          <ul role="status" className="list-disc rounded-lg border border-amber-200 bg-amber-50 py-2 pl-7 pr-3 text-[12.5px] text-amber-900">
            {problems.map((p) => <li key={p}>{p}</li>)}
          </ul>
        )}
        <div className="flex flex-wrap gap-2">
          <Button disabled={!sql} onClick={() => open(true)}><Play className="size-3.5 fill-current" />Run</Button>
          <Button variant="outline" disabled={!sql} onClick={() => open(false)}><SquarePen className="size-4" />Open in editor</Button>
          <Button variant="ghost" disabled={!sql} onClick={() => { void navigator.clipboard.writeText(sql); setCopied(true); setTimeout(() => setCopied(false), 1500) }}>
            <ClipboardCopy className="size-4" />{copied ? 'Copied' : 'Copy'}
          </Button>
        </div>
        <p className="text-[12px] text-ink-mute">In the editor, replace any value with {'{{name}}'} to turn it into a variable, then save it as a template.</p>
      </aside>
    </div>
  )
}
