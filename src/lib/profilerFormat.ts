import type { Flag } from '@shared/profiler'
import { THRESHOLDS } from '@shared/profilerAnalysis'

/** 4.2 ms, 85 ms, 1.21 s */
export function formatMs(ms: number): string {
  if (ms >= 1000) return `${(ms / 1000).toFixed(2)} s`
  if (ms >= 10) return `${Math.round(ms)} ms`
  return `${ms.toFixed(1)} ms`
}

export const formatCount = (n: number) => (Number.isInteger(n) ? n.toLocaleString() : n.toFixed(1))

export const FLAGS: Record<Flag, { label: string; meaning: string; tone: string }> = {
  slow: { label: 'Slow', meaning: `A typical request takes ${THRESHOLDS.slowRequestMs / 1000} s or more.`, tone: 'bg-red-100 text-red-800' },
  'n+1': { label: 'N+1', meaning: `The same query runs ${THRESHOLDS.nPlusOne} or more times in one request, usually once per row of an earlier result.`, tone: 'bg-var-bg text-var-ink' },
  'slow-query': { label: 'Slow query', meaning: `One query typically takes ${THRESHOLDS.slowQueryMs} ms or more.`, tone: 'bg-red-100 text-red-800' },
  chatty: { label: 'Chatty', meaning: `More than ${THRESHOLDS.chatty} queries per request.`, tone: 'bg-var-bg text-var-ink' },
  'db-heavy': { label: 'Database-bound', meaning: `At least ${THRESHOLDS.dbHeavyShare * 100}% of the request is spent waiting on the database.`, tone: 'bg-sky-100 text-sky-800' },
  errors: { label: 'Errors', meaning: 'Some requests answered with a server error (5xx).', tone: 'bg-red-100 text-red-800' },
}

export const METHOD_TONE: Record<string, string> = {
  GET: 'text-accent-deep', POST: 'text-[#0369a1]', PUT: 'text-var-ink', PATCH: 'text-var-ink', DELETE: 'text-red-700',
}
