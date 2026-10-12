import type { RecordedRequest } from '@shared/profiler'
import { formatMs } from '@/lib/profilerFormat'

const MAX_ROWS = 60

/** One request drawn left to right: each query is a bar placed where it ran and as wide as it took. */
export function RequestTimeline({ request }: { request: RecordedRequest }) {
  const total = Math.max(request.ms, ...request.db.map((q) => q.offsetMs + q.ms), 1)
  const shown = request.db.slice(0, MAX_ROWS)
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2 text-[11.5px] text-ink-mute">
        <span className="min-w-0 flex-1 truncate font-mono">{request.method} {request.path}{request.query && `?${request.query}`}</span>
        <span>{formatMs(request.ms)} · {request.db.length} {request.db.length === 1 ? 'query' : 'queries'} · status {request.status ?? 'unknown'}</span>
      </div>
      <div className="relative h-2 rounded bg-mint" title={`Whole request: ${formatMs(request.ms)}`} style={{ width: `${(request.ms / total) * 100}%` }} />
      {shown.map((q, i) => {
        const start = (q.offsetMs / total) * 100
        const end = ((q.offsetMs + q.ms) / total) * 100
        const label = `${formatMs(q.ms)} · ${q.sql.replace(/\s+/g, ' ').trim().slice(0, 90)}`
        return (
          <div key={i} className="relative h-3.5" title={`${formatMs(q.ms)}, starting ${formatMs(q.offsetMs)} in\n${q.sql.trim().slice(0, 400)}`}>
            <div className="absolute inset-y-0.5 min-w-[2px] rounded-sm bg-brand" style={{ left: `${start}%`, width: `${end - start}%` }} />
            {end <= 60
              ? <span className="absolute inset-y-0 truncate pl-1 font-mono text-[10.5px] leading-[14px] text-ink-mute" style={{ left: `${end}%`, right: 0 }}>{label}</span>
              : <span className="absolute inset-y-0 truncate pr-1 text-right font-mono text-[10.5px] leading-[14px] text-ink-mute" style={{ left: 0, right: `${100 - start}%` }}>{label}</span>}
          </div>
        )
      })}
      {request.db.length > shown.length && <div className="text-[11.5px] text-ink-mute">and {request.db.length - shown.length} more queries</div>}
      {request.db.length === 0 && <div className="text-[12px] text-ink-mute">This request ran no queries.</div>}
    </div>
  )
}
