import { ArrowDown } from 'lucide-react'
import type { EndpointSummary, RecordingSummary } from '@shared/profiler'
import { formatCount, formatMs, METHOD_TONE } from '@/lib/profilerFormat'
import { cn, matches } from '@/lib/utils'
import { useProfiler, type EndpointSort } from '@/store/profilerStore'
import { ChangeBadge } from './ChangeBadge'
import { FlagPill } from './FlagPill'

const SORTS: Record<EndpointSort, (e: EndpointSummary) => number | string> = {
  median: (e) => -e.ms.median, p95: (e) => -e.ms.p95, db: (e) => -e.dbMs, queries: (e) => -e.queriesPerCall, calls: (e) => -e.calls, route: (e) => e.route.toLowerCase(),
}

/** Every endpoint of a recording, one per line, ranked. */
export function EndpointTable({ summary, baseline }: { summary: RecordingSummary; baseline: RecordingSummary | null }) {
  const sort = useProfiler((s) => s.sort)
  const filter = useProfiler((s) => s.filter)
  const onlyFlagged = useProfiler((s) => s.onlyFlagged)
  const selected = useProfiler((s) => s.endpointKey)
  const { set } = useProfiler.getState()

  const shown = summary.endpoints
    .filter((e) => (!onlyFlagged || e.flags.length > 0) && matches(`${e.method} ${e.route}`, filter))
    .sort((a, b) => { const x = SORTS[sort](a); const y = SORTS[sort](b); return x < y ? -1 : x > y ? 1 : 0 })
  const worst = Math.max(...summary.endpoints.map((e) => e.ms.median), 1)
  const before = new Map(baseline?.endpoints.map((e) => [e.key, e]))

  const head = (id: EndpointSort, label: string, title: string, right = true) => (
    <th className={cn('px-2.5 py-1.5 font-semibold', right && 'text-right')}>
      <button onClick={() => set({ sort: id })} title={title} className={cn('inline-flex items-center gap-1 hover:text-ink', sort === id && 'text-ink')}>
        {label}{sort === id && <ArrowDown className="size-3" />}
      </button>
    </th>
  )

  return (
    <div className="overflow-x-auto rounded-[10px] border border-gray-200 bg-white">
      <table className="w-full min-w-[760px] border-collapse text-[12.5px]">
        <thead>
          <tr className="border-b border-line bg-panel text-left text-[11.5px] text-ink-mute">
            {head('route', 'Endpoint', 'Sort by name', false)}
            {head('calls', 'Calls', 'Requests recorded, after leaving out cancelled ones')}
            {head('median', 'Typical', 'The median request: half were faster, half slower')}
            {baseline && <th className="px-2.5 py-1.5 text-right font-semibold" title={'Change in typical time since the baseline recording'}>vs baseline</th>}
            {head('p95', '95th pct', 'Only 1 request in 20 was slower than this')}
            {head('db', 'In database', 'Time a typical request spends waiting on queries')}
            {head('queries', 'Queries', 'Queries a typical request runs')}
            <th className="px-2.5 py-1.5 font-semibold">Flags</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((e) => (
            <tr key={e.key} onClick={() => set({ endpointKey: e.key === selected ? '' : e.key })} aria-selected={e.key === selected}
                className={cn('cursor-pointer border-b border-line-soft last:border-0 hover:bg-panel/70', e.key === selected && 'bg-mint/40 hover:bg-mint/40')}>
              <td className="max-w-[420px] px-2.5 py-1.5">
                <div className="flex items-baseline gap-2 font-mono text-[12px]">
                  <span className={cn('w-11 shrink-0 font-semibold', METHOD_TONE[e.method])}>{e.method}</span>
                  <span className="truncate" title={e.route}>{e.route}</span>
                </div>
                <div className="relative mt-1 h-1.5 rounded-full bg-panel-header" title="Light: typical request time. Dark: the part spent in the database.">
                  <div className="absolute inset-y-0 left-0 rounded-full bg-mint" style={{ width: `${(e.ms.median / worst) * 100}%` }} />
                  <div className="absolute inset-y-0 left-0 rounded-full bg-brand" style={{ width: `${(Math.min(e.dbMs, e.ms.median) / worst) * 100}%` }} />
                </div>
              </td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{e.calls}{e.variants.length < e.calls && <span className="text-ink-mute" title={`${e.variants.length} distinct requests; identical ones are collapsed`}> / {e.variants.length}</span>}</td>
              <td className="px-2.5 py-1.5 text-right font-medium tabular-nums">{formatMs(e.ms.median)}</td>
              {baseline && <td className="px-2.5 py-1.5 text-right"><ChangeBadge now={e.ms.median} before={before.get(e.key)?.ms.median} /></td>}
              <td className="px-2.5 py-1.5 text-right tabular-nums text-ink-mute">{formatMs(e.ms.p95)}</td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatMs(e.dbMs)} <span className="text-ink-mute">{Math.round(e.dbShare * 100)}%</span></td>
              <td className="px-2.5 py-1.5 text-right tabular-nums">{formatCount(e.queriesPerCall)}</td>
              <td className="px-2.5 py-1.5"><div className="flex flex-wrap gap-1">{e.flags.map((f) => <FlagPill key={f} flag={f} />)}</div></td>
            </tr>
          ))}
          {shown.length === 0 && <tr><td colSpan={8} className="px-3 py-6 text-center text-ink-mute">No endpoint matches.</td></tr>}
        </tbody>
      </table>
    </div>
  )
}
