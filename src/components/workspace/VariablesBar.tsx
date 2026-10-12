import { Eye } from 'lucide-react'
import { tableKey } from '@/lib/sqlBuilder'
import { NULL_VALUE, VAR_HELP, canBeNull, parseVars, renderSql } from '@/lib/template'
import { cn } from '@/lib/utils'
import { useDialect, useStore, useTables, type Tab } from '@/store'
import { Button } from '@/ui/button'
import { SectionLabel } from '@/ui/input'

/** One input per {{variable}} in the query. Hidden when the query has none. */
export function VariablesBar({ tab }: { tab: Tab }) {
  const dialect = useDialect()
  const tables = useTables()
  const vars = parseVars(tab.sql, dialect)
  if (vars.length === 0) return null
  const { updateTab, setDialog } = useStore.getState()
  const setValue = (name: string, value: string) => updateTab(tab.id, { vars: { ...tab.vars, [name]: value } })
  const names = [...new Set(tables.flatMap((t) => [tableKey(t), ...t.columns.map((c) => c.name)]))]
  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-line bg-panel px-3 py-1.5">
      <SectionLabel className="text-var-ink">Variables</SectionLabel>
      {vars.map((v) => {
        const isNull = tab.vars[v.name] === NULL_VALUE
        return (
          <span key={v.name} className="flex items-center gap-1.5 text-[12px] text-ink-mute">
            <label className="flex items-center gap-1.5" title={VAR_HELP[v.type]}>
              {v.name}
              <input
                value={isNull ? '' : tab.vars[v.name] ?? ''}
                disabled={isNull}
                placeholder={isNull ? 'NULL' : v.default || (v.default === '' ? 'empty' : v.type === 'date' ? 'YYYY-MM-DD' : v.type)}
                list={v.type === 'ident' ? 'quarry-identifiers' : undefined}
                inputMode={v.type === 'number' ? 'decimal' : undefined}
                onChange={(e) => setValue(v.name, e.target.value)}
                className={cn(
                  'h-7 w-36 rounded-md border border-line bg-white px-2 text-[12px] text-ink placeholder:text-gray-400 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-brand',
                  isNull && 'bg-panel-header placeholder:text-ink-mute',
                )}
              />
            </label>
            {canBeNull(v.type) && (
              <label className="flex items-center gap-1" title={`Send NULL for ${v.name}. Remember that "= NULL" matches nothing; use IS NULL to find missing values.`}>
                <input type="checkbox" className="accent-brand" checked={isNull} onChange={(e) => setValue(v.name, e.target.checked ? NULL_VALUE : '')} />
                null
              </label>
            )}
          </span>
        )
      })}
      <datalist id="quarry-identifiers">{names.map((n) => <option key={n} value={n} />)}</datalist>
      <Button variant="ghost" size="xs" className="ml-auto" onClick={() => setDialog({ kind: 'preview', ...renderSql(tab.sql, tab.vars, dialect) })}>
        <Eye className="size-3.5" />Preview final SQL
      </Button>
    </div>
  )
}
