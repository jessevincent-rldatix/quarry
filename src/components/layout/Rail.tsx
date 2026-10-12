import { Blocks, Cable, FileStack, FolderOpen, Gauge, History, Table2, Workflow } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useStore, type Panel } from '@/store'

/** The narrow strip of section buttons down the left edge. */
export function Rail() {
  const panel = useStore((s) => s.panel)
  const view = useStore((s) => s.view)
  const { set, setDialog } = useStore.getState()
  const item = (label: string, icon: React.ReactNode, active: boolean, onClick: () => void) => (
    <button onClick={onClick} aria-pressed={active}
            className={cn('flex w-full flex-col items-center gap-0.5 rounded-lg py-1.5 text-[9px] leading-[1.35] tracking-tight',
              active ? 'bg-brand text-white' : 'text-ink-mute hover:bg-mint-hover/40')}>
      {icon}{label}
    </button>
  )
  const panelItem = (id: Panel, label: string, icon: React.ReactNode) =>
    item(label, icon, view === 'editor' && panel === id, () => set({ panel: id, view: 'editor' }))
  return (
    <nav aria-label="Sections" className="flex w-14 shrink-0 flex-col items-center gap-1 border-r border-line bg-panel px-1 py-2 max-md:w-full max-md:flex-row max-md:border-b max-md:border-r-0 max-md:[&>button]:w-14">
      {panelItem('library', 'Library', <FolderOpen className="size-[18px]" />)}
      {panelItem('schema', 'Schema', <Table2 className="size-[18px]" />)}
      {panelItem('history', 'History', <History className="size-[18px]" />)}
      <div className="my-1.5 h-px w-7 bg-line max-md:hidden" />
      {item('Templates', <FileStack className="size-[18px]" />, view === 'templates', () => set({ view: 'templates' }))}
      {item('Builder', <Blocks className="size-[18px]" />, view === 'builder', () => set({ view: 'builder' }))}
      {item('Map', <Workflow className="size-[18px]" />, view === 'map', () => set({ view: 'map' }))}
      <div className="my-1.5 h-px w-7 bg-line max-md:hidden" />
      {item('Profiler', <Gauge className="size-[18px]" />, view === 'profiler', () => set({ view: 'profiler' }))}
      <div className="flex-1" />
      {item('Connect', <Cable className="size-[18px]" />, false, () => setDialog({ kind: 'connections' }))}
    </nav>
  )
}
