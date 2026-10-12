import { KeyRound, Link2 } from 'lucide-react'
import { memo } from 'react'
import type { SchemaTable } from '@shared/types'
import { cn } from '@/lib/utils'
import { Handle, type Node, type NodeProps, Position } from '@xyflow/react'
import { HEADER, MAX_ROWS, NODE_WIDTH, ROW } from './layout'

export type TableNodeData = { table: SchemaTable; linked: Set<string>; dim: boolean; onPreview: (t: SchemaTable) => void }

export const TableNode = memo(({ data, selected }: NodeProps<Node<TableNodeData>>) => {
  const { table, linked, dim } = data
  const shown = table.columns.slice(0, MAX_ROWS)
  return (
    <div className={cn('rounded-lg border bg-white text-[12px] shadow-sm transition-opacity', selected ? 'border-brand ring-2 ring-brand/30' : 'border-line', dim && 'opacity-30')}
         style={{ width: NODE_WIDTH }} onDoubleClick={() => data.onPreview(table)} title="Double-click to preview rows">
      <Handle type="target" position={Position.Left} className="!size-1.5 !border-0 !bg-accent-deep" />
      <Handle type="source" position={Position.Right} className="!size-1.5 !border-0 !bg-accent-deep" />
      <div className={cn('flex items-center gap-1.5 rounded-t-lg px-2.5 font-semibold text-white', table.kind === 'view' ? 'bg-[#6d28d9]' : 'bg-brand')} style={{ height: HEADER }}>
        <span className="truncate">{table.name}</span>
        {table.schema && <span className="ml-auto shrink-0 text-[10px] font-normal text-chrome-text">{table.schema}</span>}
      </div>
      {shown.map((c) => (
        <div key={c.name} className="flex items-center gap-1.5 border-t border-line-soft px-2.5 font-mono text-[11px]" style={{ height: ROW }}>
          {c.pk ? <KeyRound className="size-3 shrink-0 text-amber-600" aria-label="Primary key" />
            : linked.has(c.name) ? <Link2 className="size-3 shrink-0 text-accent-deep" aria-label="Foreign key" />
            : <span className="w-3 shrink-0" />}
          <span className={cn('min-w-0 flex-1 truncate', c.pk && 'font-semibold')}>{c.name}</span>
          <span className="shrink-0 font-sans text-[10px] text-ink-mute">{c.type.toLowerCase()}</span>
        </div>
      ))}
      {table.columns.length > shown.length && (
        <div className="border-t border-line-soft px-2.5 text-[11px] text-ink-mute" style={{ height: ROW, lineHeight: `${ROW}px` }}>+ {table.columns.length - shown.length} more columns</div>
      )}
    </div>
  )
})
TableNode.displayName = 'TableNode'
