import { useEffect, useState } from 'react'
import { Circle, Loader2, Square } from 'lucide-react'
import { useElapsed } from '@/hooks/useElapsed'
import { formatMs } from '@/lib/profilerFormat'
import { cn } from '@/lib/utils'
import { useProfiler } from '@/store/profilerStore'
import { Button } from '@/ui/button'
import { Input } from '@/ui/input'

/** Start and stop a recording, and show whether the backend's traces are arriving at all. */
export function RecordBar() {
  const status = useProfiler((s) => s.status)
  const projectId = useProfiler((s) => s.projectId)
  const active = status?.active ?? null
  const [name, setName] = useState('')
  const [now, setNow] = useState(Date.now())
  const elapsed = useElapsed(Boolean(active), active?.startedAt)
  const { start, stop, refreshStatus } = useProfiler.getState()

  // Poll faster while recording so the counters feel live.
  useEffect(() => {
    const timer = setInterval(() => { void refreshStatus(); setNow(Date.now()) }, active ? 1000 : 3000)
    return () => clearInterval(timer)
  }, [active !== null, refreshStatus])

  if (!status) return null
  const heardRecently = status.lastSpanAt !== null && now - status.lastSpanAt < 60_000
  const elsewhere = active && active.projectId !== projectId

  return (
    <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-2 border-b border-line bg-panel-header px-4 py-2">
      {active ? (
        <>
          <Button variant="destructive" size="sm" disabled={active.finishing} onClick={() => void stop()}>
            {active.finishing ? <Loader2 className="size-3.5 animate-spin" /> : <Square className="size-3 fill-current" />}{active.finishing ? 'Finishing' : 'Stop'}
          </Button>
          {active.finishing
            ? <span className="font-medium" title="The backend sends its traces in batches every few seconds.">Collecting the last traces for “{active.name}”</span>
            : <span className="flex items-center gap-1.5 font-medium"><Circle className="size-2.5 animate-pulse fill-red-600 text-red-600" />Recording “{active.name}”</span>}
          {!active.finishing && <span className="text-ink-mute">{Math.floor(elapsed / 60)}:{String(Math.floor(elapsed % 60)).padStart(2, '0')}</span>}
          <span>{active.requests.toLocaleString()} requests</span>
          <span>{active.queries.toLocaleString()} queries</span>
          {active.aborted > 0 && <span className="text-ink-mute" title="Requests the browser cancelled. They are left out of the results.">{active.aborted} cancelled, ignored</span>}
          {active.latest[0] && <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-mute">latest: {active.latest[0].method} {active.latest[0].path} · {formatMs(active.latest[0].ms)}</span>}
          {elsewhere && <span className="text-var-ink">This recording belongs to another project.</span>}
          {!active.finishing && <span className="basis-full text-[11.5px] text-ink-mute">Counts trail a few seconds behind: the backend sends its traces in batches.</span>}
        </>
      ) : (
        <>
          <Button size="sm" disabled={!projectId} onClick={() => { void start(name); setName('') }}><Circle className="size-3 fill-red-500 text-red-500" />Record</Button>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this recording (optional)" aria-label="Recording name" className="h-8 w-64 text-[12.5px]"
                 onKeyDown={(e) => { if (e.key === 'Enter' && projectId) { void start(name); setName('') } }} />
          <span className="flex items-center gap-1.5 text-[12px] text-ink-mute">
            <span className={cn('size-[7px] rounded-full', heardRecently ? 'bg-accent' : 'bg-gray-300')} />
            {status.grpcError ?? (heardRecently
              ? 'Backend connected: traces are arriving.'
              : status.spansSeen > 0 ? 'No traces in the last minute. Is the backend still running?'
              : `Waiting for the backend. Run it with dotnet run; it sends traces to localhost:${status.grpcPort}.`)}
          </span>
        </>
      )}
    </div>
  )
}
