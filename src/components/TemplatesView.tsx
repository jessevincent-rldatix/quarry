import { useMemo, useRef, useState } from 'react'
import { FileStack, Pencil, Play, Plus, SquarePen, Trash2 } from 'lucide-react'
import { BUILTIN_TEMPLATES, MY_TEMPLATES, templateSql, type Template } from '@/lib/builtins'
import { tableKey } from '@/lib/sqlBuilder'
import { VAR_HELP, parseVars, renderSql } from '@/lib/template'
import { cn, matches } from '@/lib/utils'
import { useConnection, useDialect, useStore, useTables } from '@/store'
import { Button } from '@/ui/button'
import { Field, Input, SectionLabel } from '@/ui/input'

const ALL = 'All templates'

export function TemplatesView() {
  const mine = useStore((s) => s.templates)
  const dialect = useDialect()
  const connection = useConnection()
  const tables = useTables()
  const [category, setCategory] = useState(ALL)
  const [search, setSearch] = useState('')
  // Kept in the store so the chosen template and its filled-in values survive a trip to the editor.
  const { id: selectedId, values } = useStore((s) => s.templatePick)
  const setValues = (next: Record<string, string>) => useStore.getState().set({ templatePick: { id: selectedId, values: next } })
  const { openSql, runTab, setDialog, deleteTemplate } = useStore.getState()
  const details = useRef<HTMLElement>(null)

  const all = useMemo(() => [...BUILTIN_TEMPLATES, ...mine], [mine])
  const categories = useMemo(() => [ALL, ...new Set(all.map((t) => t.category)), ...(mine.length ? [] : [MY_TEMPLATES])], [all, mine.length])
  const shown = all.filter((t) => (category === ALL || t.category === category) && matches(`${t.name} ${t.description} ${t.category}`, search))
  const selected = all.find((t) => t.id === selectedId) ?? shown[0]
  const sql = selected ? templateSql(selected, dialect, tables) : null
  const vars = sql ? parseVars(sql, dialect) : []
  const rendered = sql ? renderSql(sql, values, dialect) : null
  const names = [...new Set(tables.flatMap((t) => [tableKey(t), ...t.columns.map((c) => c.name)]))]

  const open = (run: boolean) => {
    if (!selected || !sql) return
    const id = openSql({ title: selected.name, sql, vars: values, connectionId: useStore.getState().activeConnectionId })
    if (run) void runTab(id)
  }

  const pick = (id: string) => {
    useStore.getState().set({ templatePick: { id, values: {} } })
    // On a narrow window the details sit below the cards; bring them into view.
    requestAnimationFrame(() => details.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }))
  }

  const edit = (template?: Template) => setDialog({ kind: 'template', template })

  return (
    <div className="flex min-h-0 min-w-0 flex-1 flex-wrap overflow-y-auto bg-editor xl:flex-nowrap xl:overflow-hidden">
      <aside className="flex w-full shrink-0 flex-col gap-px border-r border-line bg-panel p-2.5 md:w-[200px]" aria-label="Template categories">
        <SectionLabel className="px-1.5 py-1">Templates</SectionLabel>
        {categories.map((c) => {
          const count = c === ALL ? all.length : all.filter((t) => t.category === c).length
          return (
            <button key={c} onClick={() => setCategory(c)} aria-pressed={category === c}
                    className={cn('flex h-7 items-center rounded-md px-2 text-left text-[12.5px] hover:bg-mint-hover/40', category === c && 'bg-mint font-medium text-brand hover:bg-mint')}>
              <span className="flex-1 truncate">{c}</span>
              <span className="text-[11px] font-normal text-ink-mute">{count}</span>
            </button>
          )
        })}
      </aside>

      <main className="scrollbars-visible flex min-w-0 flex-1 basis-[420px] flex-col gap-4 p-5 xl:overflow-y-auto">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-[200px] flex-1">
            <h1 className="text-[18px] font-semibold text-brand">{category}</h1>
            <p className="text-ink-mute">Reusable queries with fill-in variables. Pick one, fill the blanks, run.</p>
          </div>
          <Input className="w-56" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search templates" aria-label="Search templates" />
          <Button onClick={() => edit()}><Plus className="size-4" />New template</Button>
        </div>

        <div className="grid grid-cols-[repeat(auto-fill,minmax(230px,1fr))] gap-3">
          {shown.map((template) => {
            const body = templateSql(template, dialect, tables)
            const isSelected = selected?.id === template.id
            return (
              <button key={template.id} onClick={() => pick(template.id)} aria-pressed={isSelected}
                      className={cn('flex flex-col gap-2 rounded-[10px] border bg-white p-3.5 text-left shadow-xs hover:border-brand/50',
                        isSelected ? 'border-brand ring-1 ring-brand' : 'border-gray-200', !body && 'opacity-60')}>
                <span className="text-[14px] font-semibold text-brand">{template.name}</span>
                <span className="min-h-[38px] text-[12.5px] text-ink-mute">{template.description}</span>
                <span className="flex flex-wrap gap-1">
                  {body
                    ? parseVars(body).map((v) => <span key={v.name} className="rounded bg-var-bg px-1.5 font-mono text-[11px] text-var-ink">{v.name}</span>)
                    : <span className="text-[11px] text-ink-mute">Not available on this database</span>}
                </span>
              </button>
            )
          })}
          {shown.length === 0 && (
            <div className="col-span-full rounded-[10px] border border-dashed border-line p-6 text-center text-ink-mute">
              {category === MY_TEMPLATES && !search ? 'You have no templates of your own yet. Write a query with {{variables}} and choose "Save as template".' : 'No template matches.'}
            </div>
          )}
        </div>
      </main>

      {selected && (
        <aside className="scrollbars-visible flex w-full shrink-0 flex-col gap-3.5 border-l border-line bg-white p-5 xl:w-[380px] xl:overflow-y-auto" aria-label="Template details" ref={details}>
          <div>
            <SectionLabel>{selected.builtin ? 'Template' : 'My template'}</SectionLabel>
            <h2 className="mt-0.5 text-[16px] font-semibold text-brand">{selected.name}</h2>
            <p className="text-[12.5px] text-ink-mute">{selected.description}</p>
          </div>

          {!sql ? (
            <p className="rounded-lg border border-line-soft bg-panel p-3 text-[12.5px]">
              This template has no SQL for {connection?.name ?? 'this connection'}. Switch connection to use it.
            </p>
          ) : (
            <>
              {vars.length > 0 && (
                <div className="flex flex-col gap-2.5">
                  {vars.map((v) => (
                    <Field key={v.name} label={v.name} hint={`${VAR_HELP[v.type]}${v.default ? `, default ${v.default}` : ''}`}>
                      <Input value={values[v.name] ?? ''} placeholder={v.default ?? (v.type === 'date' ? 'YYYY-MM-DD' : '')}
                             list={v.type === 'ident' ? 'quarry-template-identifiers' : undefined}
                             onChange={(e) => setValues({ ...values, [v.name]: e.target.value })} />
                    </Field>
                  ))}
                  <datalist id="quarry-template-identifiers">{names.map((n) => <option key={n} value={n} />)}</datalist>
                </div>
              )}
              <div className="flex flex-col gap-1">
                <SectionLabel>Final SQL</SectionLabel>
                <pre className="scrollbars-visible overflow-x-auto rounded-lg border border-line-soft bg-editor p-3 font-mono text-[12.5px] leading-5">{rendered?.sql}</pre>
                {rendered && rendered.errors.length > 0 && <p className="text-[12px] text-var-ink">Still needed: {rendered.errors.join('; ')}.</p>}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button disabled={!rendered || rendered.errors.length > 0} onClick={() => open(true)}><Play className="size-3.5 fill-current" />Run</Button>
                <Button variant="outline" onClick={() => open(false)}><SquarePen className="size-4" />Open in editor</Button>
              </div>
              <div className="flex flex-wrap gap-1 border-t border-line-soft pt-3">
                {selected.builtin ? (
                  <Button variant="ghost" size="sm" onClick={() => setDialog({ kind: 'template', sql })}><FileStack className="size-3.5" />Copy to my templates</Button>
                ) : (
                  <>
                    <Button variant="ghost" size="sm" onClick={() => edit(selected)}><Pencil className="size-3.5" />Edit</Button>
                    <Button variant="ghost" size="sm" className="text-red-700" onClick={() => setDialog({
                      kind: 'confirm', danger: true, action: 'Delete', title: `Delete template "${selected.name}"?`,
                      body: 'This cannot be undone.', onConfirm: () => deleteTemplate(selected.id),
                    })}><Trash2 className="size-3.5" />Delete</Button>
                  </>
                )}
              </div>
            </>
          )}
        </aside>
      )}
    </div>
  )
}
