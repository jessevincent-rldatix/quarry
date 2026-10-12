import { useStore } from '@/store'
import { HistoryPanel } from './HistoryPanel'
import { LibraryPanel } from './LibraryPanel'
import { SchemaPanel } from './SchemaPanel'

export function SidePanel() {
  const panel = useStore((s) => s.panel)
  return (
    <aside className="flex w-[272px] shrink-0 flex-col gap-2.5 border-r border-line bg-panel p-2.5 max-md:w-full max-md:max-h-[40vh]" aria-label={panel}>
      {panel === 'library' ? <LibraryPanel /> : panel === 'schema' ? <SchemaPanel /> : <HistoryPanel />}
    </aside>
  )
}
