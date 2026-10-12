import { Loader2, RefreshCw } from 'lucide-react'
import { useStore } from '@/store'
import { Button } from '@/ui/button'

/** State of the local index of table and column names for the current connection. */
export function IndexStatus() {
  const ai = useStore((s) => s.ai)
  if (!ai?.configured) return null
  const { index, settings } = ai
  const build = () => void useStore.getState().buildIndex().catch((err: Error) => useStore.getState().setDialog({
    kind: 'confirm', title: 'The index could not be built', body: err.message, action: 'Open AI settings',
    onConfirm: () => useStore.getState().setDialog({ kind: 'ai-settings' }),
  }))

  return (
    <div className="flex min-h-8 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 border-b border-line-soft bg-panel px-2.5 py-1 text-[12px] text-ink-mute">
      {index.state === 'building' ? (
        <><Loader2 className="size-3.5 animate-spin text-accent-deep" />Indexing {index.done.toLocaleString()} of {index.items.toLocaleString()} names</>
      ) : index.state === 'ready' ? (
        <><span className="size-[7px] rounded-full bg-accent" />Index: {index.items.toLocaleString()} names{index.builtAt ? `, built ${new Date(index.builtAt).toLocaleDateString()}` : ''}</>
      ) : index.state === 'error' ? (
        <span className="text-red-800" title={index.error}>Index failed: {index.error}</span>
      ) : settings.embedEndpoint ? (
        <>No index yet. Tables are picked by matching words.</>
      ) : (
        <>No embedding endpoint set. Tables are picked by matching words.</>
      )}
      {settings.embedEndpoint && index.state !== 'building' && (
        <Button variant="ghost" size="xs" className="ml-auto" onClick={build}>
          <RefreshCw className="size-3.5" />{index.state === 'ready' ? 'Rebuild' : 'Build index'}
        </Button>
      )}
    </div>
  )
}
