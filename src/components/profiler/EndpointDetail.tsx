import { SquarePen, X } from 'lucide-react'
import type { EndpointSummary } from '@shared/profiler'
import { THRESHOLDS } from '@shared/profilerAnalysis'
import { FLAGS, formatCount, formatMs } from '@/lib/profilerFormat'
import { cn } from '@/lib/utils'
import { useStore } from '@/store'
import { useProfiler } from '@/store/profilerStore'
import { Button } from '@/ui/button'
import { SectionLabel } from '@/ui/input'
import { FlagPill } from './FlagPill'
import { RequestTimeline } from './RequestTimeline'

/** Everything recorded about one endpoint: what was flagged, its queries, its distinct requests, and its slowest request drawn out. */
export function EndpointDetail({ endpoint }: { endpoint: EndpointSummary }) {
  const openInEditor = (sql: string) => {
    const { openSql, activeConnectionId } = useStore.getState()
    openSql({ sql: sql.trim(), title: endpoint.route.split('/').filter(Boolean).pop() ?? 'query', connectionId: activeConnectionId })
  }
  return (
    <section aria-label="Endpoint details" className="flex flex-col gap-4 rounded-[10px] border border-brand/40 bg-white p-4">
      <div className="flex flex-wrap items-start gap-2">
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-mono text-[14px] font-semibold text-brand">{endpoint.method} {endpoint.route}</h2>
          <p className="text-[12.5px] text-ink-mute">
            {endpoint.calls} request{endpoint.calls === 1 ? '' : 's'} recorded. Typical {formatMs(endpoint.ms.median)}, fastest {formatMs(endpoint.ms.min)}, slowest {formatMs(endpoint.ms.max)}.
            {' '}A typical request spends {formatMs(endpoint.dbMs)} ({Math.round(endpoint.dbShare * 100)}%) in the database across {formatCount(endpoint.queriesPerCall)} {endpoint.queriesPerCall === 1 ? 'query' : 'queries'}.
            {endpoint.aborted > 0 && ` ${endpoint.aborted} cancelled request${endpoint.aborted === 1 ? ' was' : 's were'} left out.`}
          </p>
        </div>
        <Button variant="ghost" size="icon-sm" aria-label="Close details" onClick={() => useProfiler.getState().set({ endpointKey: '' })}><X className="size-4" /></Button>
      </div>

      {endpoint.flags.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {endpoint.flags.map((f) => <li key={f} className="flex items-baseline gap-2"><FlagPill flag={f} /><span>{FLAGS[f].meaning}</span></li>)}
        </ul>
      )}

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Queries, costliest first</SectionLabel>
        {endpoint.queries.length === 0 && <p className="text-[12.5px] text-ink-mute">No queries were recorded for this endpoint.</p>}
        {endpoint.queries.map((q) => (
          <div key={q.fingerprint} className={cn('rounded-lg border bg-editor', q.nPlusOne || q.ms.median >= THRESHOLDS.slowQueryMs ? 'border-amber-300' : 'border-line-soft')}>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line-soft px-2.5 py-1 text-[12px]">
              <span className="rounded bg-panel-header px-1.5 text-[11px] text-ink-mute">{q.store}</span>
              <span><b>{formatCount(q.perCall)}×</b> per request{q.maxPerCall > q.perCall && <span className="text-ink-mute">, up to {q.maxPerCall}</span>}</span>
              <span><b>{formatMs(q.ms.median)}</b> each<span className="text-ink-mute">, worst {formatMs(q.ms.max)}</span></span>
              {q.rows !== null && <span className="text-ink-mute">{formatCount(q.rows)} row{q.rows === 1 ? '' : 's'}</span>}
              {q.nPlusOne && <FlagPill flag="n+1" />}
              {q.ms.median >= THRESHOLDS.slowQueryMs && <FlagPill flag="slow-query" />}
              <Button variant="ghost" size="xs" className="ml-auto" onClick={() => openInEditor(q.sql)}><SquarePen className="size-3.5" />Open in editor</Button>
            </div>
            <pre className="scrollbars-visible max-h-40 overflow-auto whitespace-pre-wrap p-2.5 font-mono text-[12px] leading-[18px]">{q.sql.trim()}</pre>
          </div>
        ))}
      </div>

      <div className="flex flex-col gap-1.5">
        <SectionLabel>Slowest request</SectionLabel>
        <RequestTimeline request={endpoint.slowest} />
      </div>

      <div className="flex flex-col gap-1">
        <SectionLabel>Distinct requests ({endpoint.variants.length})</SectionLabel>
        <table className="w-full border-collapse text-[12px]">
          <tbody>
            {endpoint.variants.slice(0, 40).map((v) => (
              <tr key={`${v.path}?${v.query}`} className="border-b border-line-soft last:border-0">
                <td className="max-w-0 truncate py-1 pr-3 font-mono" title={`${v.path}${v.query && `?${v.query}`}`}>{v.path}{v.query && <span className="text-ink-mute">?{v.query}</span>}</td>
                <td className="w-24 whitespace-nowrap py-1 pr-3 text-right text-ink-mute">{v.count > 1 ? `${v.count} identical` : 'once'}</td>
                <td className="w-28 whitespace-nowrap py-1 pr-3 text-right">{v.doubleFired && <span className="rounded bg-panel-header px-1.5 text-[11px] text-ink-mute" title={`Sent twice at once (within ${THRESHOLDS.doubleFireMs} ms, before the first was answered), as React StrictMode does in development.`}>double-fired</span>}</td>
                <td className="w-20 whitespace-nowrap py-1 text-right tabular-nums">{formatMs(v.ms.median)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {endpoint.variants.length > 40 && <p className="text-[11.5px] text-ink-mute">and {endpoint.variants.length - 40} more</p>}
      </div>
    </section>
  )
}
