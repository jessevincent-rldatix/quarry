import type { DbCall, EndpointSummary, Flag, ProjectRoute, QuerySummary, RecordedRequest, RecordingSummary, Stats, Variant } from './profiler.ts'

/** Where the labels come from. Changing a number here changes what the report calls a problem. */
export const THRESHOLDS = {
  /** A request slower than this is "slow". */
  slowRequestMs: 1000,
  /** A single query slower than this is a "slow query". */
  slowQueryMs: 500,
  /** The same query this many times in one request is an N+1. */
  nPlusOne: 5,
  /** More queries than this in one request is "chatty". */
  chatty: 15,
  /** Database time above this share of the request is "db-heavy" (only reported on requests that are not fast). */
  dbHeavyShare: 0.8,
  dbHeavyMinMs: 300,
  /** Two identical requests starting this close together, the second before the first was answered, count as double-fired. */
  doubleFireMs: 150,
}

/**
 * Reduces a query to its shape, so the same query with different values counts as one:
 * literals become ?, lists of placeholders become one, whitespace and case are ignored.
 */
export function fingerprint(sql: string): string {
  return sql
    .replace(/--[^\n]*/g, ' ')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/N?'(?:[^']|'')*'/g, '?')
    // Placeholders first (@id, :1, $1), but not the second colon of a ::cast.
    .replace(/(?<![:\w])[@:$]\w+/g, '?')
    .replace(/\b\d+(?:\.\d+)?\b/g, '?')
    .replace(/\(\s*\?(?:\s*,\s*\?)*\s*\)/g, '(?)')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
}

/** A path with the parts that look like ids replaced, for requests that matched no declared route. */
export function collapsePath(path: string): string {
  return path
    .split('/')
    .map((part) => (/^\d+$/.test(part) || /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(part) || /^[0-9a-f]{24,}$/i.test(part) ? '{id}' : part))
    .join('/')
}

/** Makes route templates from different sources comparable: /api/Trips/{id:int} and api/trips/{tripId} are the same route. */
export function normaliseRoute(route: string): string {
  const path = `/${route}`.replace(/\/+/g, '/').replace(/\/$/, '') || '/'
  return path.replace(/\{[^}]*\}/g, '{}').toLowerCase()
}

export function stats(values: number[]): Stats {
  if (values.length === 0) return { min: 0, median: 0, p95: 0, max: 0 }
  const sorted = [...values].sort((a, b) => a - b)
  const at = (fraction: number) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))]
  const middle = sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2
  return { min: sorted[0], median: middle, p95: at(0.95), max: sorted[sorted.length - 1] }
}

const median = (values: number[]) => stats(values).median

/** Time covered by at least one query. Queries that run side by side are not counted twice. */
export function dbWallMs(calls: DbCall[]): number {
  const spans = calls.map((c) => [c.offsetMs, c.offsetMs + c.ms] as const).sort((a, b) => a[0] - b[0])
  let total = 0
  let end = -Infinity
  for (const [from, to] of spans) {
    if (to <= end) continue
    total += to - Math.max(from, end)
    end = to
  }
  return total
}

function summariseQueries(requests: RecordedRequest[]): QuerySummary[] {
  const byPrint = new Map<string, { store: string; sql: string; ms: number[]; rows: number[]; perRequest: Map<string, number> }>()
  for (const request of requests) {
    for (const call of request.db) {
      const key = `${call.store}\u0000${fingerprint(call.sql)}`
      let entry = byPrint.get(key)
      if (!entry) byPrint.set(key, (entry = { store: call.store, sql: call.sql, ms: [], rows: [], perRequest: new Map() }))
      entry.ms.push(call.ms)
      if (call.rows !== null) entry.rows.push(call.rows)
      entry.perRequest.set(request.id, (entry.perRequest.get(request.id) ?? 0) + 1)
    }
  }
  return [...byPrint.entries()].map(([key, entry]) => {
    // Requests that did not run the query at all count as zero, so an occasional query is not reported as routine.
    const counts = requests.map((r) => entry.perRequest.get(r.id) ?? 0)
    const maxPerCall = Math.max(...counts)
    return {
      fingerprint: key, store: entry.store, sql: entry.sql,
      perCall: median(counts), maxPerCall, total: entry.ms.length,
      ms: stats(entry.ms), rows: entry.rows.length ? median(entry.rows) : null,
      nPlusOne: maxPerCall >= THRESHOLDS.nPlusOne,
    }
  }).sort((a, b) => b.ms.median * Math.max(b.perCall, 1) - a.ms.median * Math.max(a.perCall, 1))
}

function summariseVariants(requests: RecordedRequest[]): Variant[] {
  const groups = new Map<string, RecordedRequest[]>()
  for (const request of requests) {
    const key = `${request.path}?${request.query}`
    groups.set(key, [...(groups.get(key) ?? []), request])
  }
  return [...groups.values()].map((same) => {
    const inOrder = [...same].sort((a, b) => a.startedAt - b.startedAt)
    return {
      path: same[0].path, query: same[0].query, count: same.length,
      // The second copy went out while the first was still being answered, and almost at once.
      doubleFired: inOrder.some((r, i) => i > 0 && r.startedAt - inOrder[i - 1].startedAt <= THRESHOLDS.doubleFireMs && r.startedAt < inOrder[i - 1].startedAt + inOrder[i - 1].ms),
      ms: stats(same.map((r) => r.ms)),
    }
  }).sort((a, b) => b.ms.median - a.ms.median)
}

/**
 * Turns the raw requests of a recording into one line per endpoint.
 *
 * Requests the client abandoned are left out of every number: in development React fires each
 * fetch twice and cancels one, and those cancelled halves are not real usage.
 */
export function summarise(requests: RecordedRequest[], declared: ProjectRoute[] = []): RecordingSummary {
  const byEndpoint = new Map<string, RecordedRequest[]>()
  for (const request of requests) {
    const key = `${request.method} ${request.route}`
    byEndpoint.set(key, [...(byEndpoint.get(key) ?? []), request])
  }

  let duplicates = 0
  const endpoints: EndpointSummary[] = []
  for (const [key, all] of byEndpoint) {
    const kept = all.filter((r) => !r.aborted)
    if (kept.length === 0) continue
    const variants = summariseVariants(kept)
    duplicates += kept.length - variants.length
    const queries = summariseQueries(kept)
    const ms = stats(kept.map((r) => r.ms))
    const dbMs = median(kept.map((r) => dbWallMs(r.db)))
    const dbShare = ms.median > 0 ? Math.min(1, dbMs / ms.median) : 0
    const queriesPerCall = median(kept.map((r) => r.db.length))
    const errors = kept.filter((r) => r.status !== null && r.status >= 500).length

    const flags: Flag[] = []
    if (ms.median >= THRESHOLDS.slowRequestMs) flags.push('slow')
    if (queries.some((q) => q.nPlusOne)) flags.push('n+1')
    if (queries.some((q) => q.ms.median >= THRESHOLDS.slowQueryMs)) flags.push('slow-query')
    if (queriesPerCall > THRESHOLDS.chatty) flags.push('chatty')
    if (dbShare >= THRESHOLDS.dbHeavyShare && ms.median >= THRESHOLDS.dbHeavyMinMs) flags.push('db-heavy')
    if (errors > 0) flags.push('errors')

    endpoints.push({
      key, method: kept[0].method, route: kept[0].route, calls: kept.length, aborted: all.length - kept.length, errors,
      ms, dbMs, dbShare, queriesPerCall, variants, queries, flags,
      slowest: kept.reduce((worst, r) => (r.ms > worst.ms ? r : worst)),
    })
  }
  endpoints.sort((a, b) => b.ms.median - a.ms.median)

  const reached = new Set(endpoints.map((e) => `${e.method} ${normaliseRoute(e.route)}`))
  return {
    endpoints,
    requests: endpoints.reduce((sum, e) => sum + e.calls, 0),
    aborted: requests.filter((r) => r.aborted).length,
    duplicates,
    queries: endpoints.reduce((sum, e) => sum + e.queries.reduce((n, q) => n + q.total, 0), 0),
    notReached: declared.filter((r) => !reached.has(`${r.method} ${normaliseRoute(r.route)}`)),
  }
}
