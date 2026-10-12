import { ChevronDown, ChevronRight, Eye, KeyRound, Table2 } from 'lucide-react'
import { useState } from 'react'
import type { SchemaTable } from '@shared/types'
import { ident, previewSql, tableKey, tableRef } from '@/lib/sqlBuilder'
import { cn, matches } from '@/lib/utils'
import { useDialect, useStore } from '@/store'
import { editorBridge } from '../editor/editorBridge'
import { row } from './styles'

interface Props {
  table: SchemaTable
  forceOpen: boolean
  search: string
  /** Under its schema's heading, the table is shown by its own name alone. */
  bare?: boolean
}

export function TableNode({ table, forceOpen, search, bare = false }: Props) {
  const dialect = useDialect()
  const [open, setOpen] = useState(false)
  const expanded = open || forceOpen
  const key = tableKey(table)
  const preview = () => {
    const id = useStore.getState().openSql({ title: table.name, sql: previewSql(table, dialect), connectionId: useStore.getState().activeConnectionId })
    void useStore.getState().runTab(id)
  }
  const columns = forceOpen && !matches(key, search) ? table.columns.filter((c) => matches(c.name, search)) : table.columns
  return (
    <div>
      <div className={row}>
        <button className="flex h-full min-w-0 flex-1 items-center gap-1.5 text-left" aria-expanded={expanded} onClick={() => setOpen(!open)}
                onDoubleClick={() => editorBridge.current?.insert(tableRef(table, dialect))} title="Double-click to insert the name">
          {expanded ? <ChevronDown className="size-3.5 shrink-0 text-ink-mute" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-mute" />}
          {table.kind === 'view' ? <Eye className="size-3.5 shrink-0 text-[#8b5cf6]" /> : <Table2 className="size-3.5 shrink-0 text-[#8b5cf6]" />}
          <span className="truncate" title={key}>{bare ? table.name : key}</span>
        </button>
        <button onClick={preview} className="shrink-0 rounded px-1 text-[11px] text-accent-deep opacity-0 hover:bg-black/10 focus-visible:opacity-100 group-hover:opacity-100">Preview</button>
        <span className="shrink-0 text-[11px] text-ink-mute">{table.columns.length}</span>
      </div>
      {expanded && columns.map((column) => (
        <button key={column.name} className={cn(row, 'h-6 pl-7 font-mono text-[12px]')} title="Click to insert the column name"
                onClick={() => editorBridge.current?.insert(ident(column.name, dialect))}>
          {column.pk && <KeyRound className="size-3 shrink-0 text-amber-600" />}
          <span className="min-w-0 flex-1 truncate">{column.name}</span>
          <span className="shrink-0 font-sans text-[11px] text-ink-mute">{column.type.toLowerCase()}{column.nullable ? '' : ' · required'}</span>
        </button>
      ))}
    </div>
  )
}
