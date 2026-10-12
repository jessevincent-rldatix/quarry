import type { RecordingSummary } from '@shared/profiler'
import { formatMs } from '@/lib/profilerFormat'

const card = 'flex min-w-[130px] flex-1 flex-col rounded-[10px] border border-gray-200 bg-white px-3.5 py-2.5'

/** The headline numbers of a recording. */
export function SummaryCards({ summary }: { summary: RecordingSummary }) {
  const flagged = summary.endpoints.filter((e) => e.flags.length > 0).length
  const slowest = summary.endpoints[0]
  const items: { label: string; value: string; note?: string }[] = [
    { label: 'Endpoints', value: String(summary.endpoints.length), note: summary.notReached.length ? `${summary.notReached.length} declared routes not reached` : undefined },
    { label: 'Requests', value: summary.requests.toLocaleString(), note: summary.duplicates ? `${summary.duplicates} identical repeats collapsed` : undefined },
    { label: 'Queries', value: summary.queries.toLocaleString() },
    { label: 'Flagged', value: String(flagged), note: flagged ? 'endpoints with something to look at' : 'nothing stands out' },
    { label: 'Slowest', value: slowest ? formatMs(slowest.ms.median) : 'none', note: slowest ? `${slowest.method} ${slowest.route}` : undefined },
    { label: 'Cancelled', value: String(summary.aborted), note: 'left out of every number' },
  ]
  return (
    <div className="flex flex-wrap gap-2.5">
      {items.map((item) => (
        <div key={item.label} className={card}>
          <span className="text-[11px] font-semibold uppercase tracking-wide text-ink-mute">{item.label}</span>
          <span className="text-[20px] font-semibold text-brand">{item.value}</span>
          {item.note && <span className="truncate text-[11.5px] text-ink-mute" title={item.note}>{item.note}</span>}
        </div>
      ))}
    </div>
  )
}
