import { useEffect, useRef } from 'react'
import { Plus, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { isDirty, useStore } from '@/store'
import { connectionPaint } from '@/ui/connection-color'
import { TabsMenu } from './TabsMenu'

/** The key that jumps to the tab at this position (see useGlobalShortcuts): Alt 1 to Alt 8, and Alt 9 for the last. */
const jumpKey = (index: number, count: number) => (index < 8 ? `Alt ${index + 1}` : index === count - 1 ? 'Alt 9' : '')

/** The row of open queries. The active tab is always scrolled into view. */
export function TabBar() {
  const tabs = useStore((s) => s.tabs)
  const queries = useStore((s) => s.queries)
  const connections = useStore((s) => s.connections)
  const activeTabId = useStore((s) => s.activeTabId)
  const running = useStore((s) => s.runs)
  const bar = useRef<HTMLDivElement>(null)
  const { activateTab, closeTab, newTab } = useStore.getState()

  useEffect(() => {
    bar.current?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [activeTabId, tabs.length])

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-line bg-panel-header">
    <div ref={bar} className="scrollbars-visible flex h-9 min-w-0 flex-1 items-stretch overflow-x-auto" role="tablist">
      {tabs.map((tab, index) => {
        const active = tab.id === activeTabId
        const connection = connections.find((c) => c.id === tab.connectionId)
        const paint = connectionPaint(connection?.color)
        const key = jumpKey(index, tabs.length)
        return (
          <div key={tab.id} role="tab" aria-selected={active}
               className={cn('group relative flex h-9 shrink-0 items-center border-r border-line text-[12.5px]', active ? 'bg-editor text-ink' : 'text-ink-mute hover:bg-black/[0.03]')}
               onMouseDown={(e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id) } }}>
            {/* A marked connection tints the whole tab and underlines it, active or not. */}
            {paint && <span aria-hidden className={cn('pointer-events-none absolute inset-0', paint.tint)} />}
            {paint && <span aria-hidden className={cn('pointer-events-none absolute inset-x-0 bottom-0 h-[3px]', paint.fill)} />}
            {active && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
            <button className="relative flex h-full items-center gap-2 pl-3 pr-1" onClick={() => activateTab(tab.id)}
                    title={`${tab.title} · runs on ${connection?.name ?? 'a removed connection'}${key ? ` · ${key}` : ''}`}>
              <span className={cn('size-1.5 shrink-0 rounded-full', running[tab.id]?.running ? 'animate-pulse bg-sky-500' : tab.queryId ? 'bg-accent' : 'bg-ink-mute/50')} />
              <span className="max-w-[220px] truncate">{tab.title}</span>
              {connection && <span className={cn('max-w-[110px] truncate text-[11px]', paint ? 'font-semibold text-ink' : 'text-ink-mute')}>{connection.name}</span>}
              {isDirty(tab, queries) && <span className="text-var-ink" title="Unsaved changes">●</span>}
            </button>
            <button aria-label={`Close ${tab.title}`} onClick={() => closeTab(tab.id)}
                    title={active ? 'Close (Alt W, or middle-click the tab)' : 'Close (middle-click the tab)'}
                    className="relative mr-1.5 rounded p-0.5 opacity-60 hover:bg-black/10 group-hover:opacity-100">
              <X className="size-3" />
            </button>
          </div>
        )
      })}
      <button aria-label="New query tab" title="New query (Alt N). Alt PageDown and Alt PageUp move between tabs." onClick={() => newTab()} className="flex w-9 shrink-0 items-center justify-center text-ink-mute hover:bg-black/[0.04]">
        <Plus className="size-4" />
      </button>
    </div>
    <TabsMenu />
    </div>
  )
}
