import { useEffect, useState } from 'react'
import { AskPanel } from './components/ask/AskPanel'
import { BuilderView } from './components/BuilderView'
import { CommandPalette } from './components/CommandPalette'
import { Dialogs } from './components/dialogs/Dialogs'
import { Chrome } from './components/layout/Chrome'
import { Rail } from './components/layout/Rail'
import { SyncBanner } from './components/layout/SyncBanner'
import { ProfilerView } from './components/profiler/ProfilerView'
import { SchemaCanvas } from './components/schema-map/SchemaCanvas'
import { SidePanel } from './components/side/SidePanel'
import { TemplatesView } from './components/TemplatesView'
import { Workspace } from './components/workspace/Workspace'
import { useGlobalShortcuts } from './hooks/useGlobalShortcuts'
import { useStore } from './store'

export function App() {
  const ready = useStore((s) => s.ready)
  const view = useStore((s) => s.view)
  const askOpen = useStore((s) => s.askOpen)
  const [error, setError] = useState('')
  useGlobalShortcuts()

  useEffect(() => {
    // The API server may still be starting when the page first loads, so try a few times.
    let cancelled = false
    const start = async (attempt: number) => {
      try {
        await useStore.getState().init()
      } catch (err) {
        if (cancelled) return
        if (attempt < 8) setTimeout(() => void start(attempt + 1), 500)
        else setError((err as Error).message)
      }
    }
    void start(0)
    return () => { cancelled = true }
  }, [])

  if (!ready) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-center text-ink-mute">
        {error ? <div><div className="mb-1 font-semibold text-red-800">Quarry could not start</div>{error}</div> : 'Loading…'}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col text-[13px]">
      <Chrome />
      <SyncBanner />
      <div className="flex min-h-0 flex-1 max-md:flex-col">
        <Rail />
        {view === 'editor' && <SidePanel />}
        {view === 'editor' ? <Workspace /> : view === 'templates' ? <TemplatesView /> : view === 'map' ? <SchemaCanvas /> : view === 'profiler' ? <ProfilerView /> : <BuilderView />}
        {askOpen && <AskPanel />}
      </div>
      <CommandPalette />
      <Dialogs />
    </div>
  )
}
