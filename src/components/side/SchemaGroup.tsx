import { ChevronDown, ChevronRight, Layers } from 'lucide-react'
import type { ReactNode } from 'react'
import { row } from './styles'

interface Props {
  /** The schema's name: the part of "arbiter.jobs" before the dot. */
  name: string
  count: number
  open: boolean
  onToggle: () => void
  children: ReactNode
}

/** One schema in the Schema panel: a heading that folds away the tables under it. */
export function SchemaGroup({ name, count, open, onToggle, children }: Props) {
  return (
    <div>
      <button className={`${row} font-medium`} aria-expanded={open} onClick={onToggle} title={open ? 'Hide these tables' : 'Show these tables'}>
        {open ? <ChevronDown className="size-3.5 shrink-0 text-ink-mute" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-mute" />}
        <Layers className="size-3.5 shrink-0 text-accent-deep" />
        <span className="min-w-0 flex-1 truncate">{name}</span>
        <span className="shrink-0 text-[11px] font-normal text-ink-mute">{count}</span>
      </button>
      {open && <div className="ml-2 flex flex-col gap-px border-l border-line-soft pl-1">{children}</div>}
    </div>
  )
}
