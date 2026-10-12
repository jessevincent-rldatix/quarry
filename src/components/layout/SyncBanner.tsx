import { useStore } from '@/store'
import { Button } from '@/ui/button'

/** Says so when the library is not being saved, which is otherwise invisible. */
export function SyncBanner() {
  const sync = useStore((s) => s.sync)
  if (sync === 'conflict') {
    return (
      <div role="alert" className="flex shrink-0 flex-wrap items-center gap-3 border-b border-amber-300 bg-var-bg px-3 py-1.5 text-var-ink">
        <span className="min-w-0 flex-1">Another Quarry window saved changes after this one loaded. This window has stopped saving so it does not overwrite them. Copy anything you need from here, then reload.</span>
        <Button variant="outline" size="xs" onClick={() => window.location.reload()}>Reload</Button>
      </div>
    )
  }
  if (sync === 'failed') {
    return <div role="alert" className="shrink-0 border-b border-red-200 bg-red-50 px-3 py-1.5 text-red-900">Changes are not being saved: the local Quarry server is not answering. Retrying every few seconds.</div>
  }
  return null
}
