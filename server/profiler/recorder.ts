import type { DbCall, RecordedRequest, RecorderStatus, Recording } from '../../shared/profiler.ts'
import { collapsePath } from '../../shared/profilerAnalysis.ts'
import { SPAN_KIND_SERVER, type Span } from './otlp.ts'

type Active = { recording: Recording; pending: Map<string, Span[]>; byTrace: Map<string, RecordedRequest>; stoppedAt: number | null }

const text = (span: Span, ...keys: string[]) => {
  for (const key of keys) if (span.attributes[key] !== undefined) return String(span.attributes[key])
  return ''
}

const round = (ms: number) => Math.round(ms * 10) / 10

function toDbCall(span: Span, requestStart: number): DbCall {
  const rows = span.attributes['db.rows']
  return {
    store: text(span, 'db.system', 'db.system.name') || 'database',
    sql: text(span, 'db.statement', 'db.query.text'),
    ms: round(span.endMs - span.startMs),
    offsetMs: round(span.startMs - requestStart),
    rows: typeof rows === 'number' ? rows : null,
  }
}

const isQuery = (span: Span) => span.attributes['db.statement'] !== undefined || span.attributes['db.query.text'] !== undefined

/** The incoming-request span of a trace. Its attributes follow either the current or the older naming. */
function toRequest(root: Span, others: Span[]): RecordedRequest | null {
  const method = text(root, 'http.request.method', 'http.method').toUpperCase()
  // Browsers send an OPTIONS before a cross-origin call. It never reaches a controller.
  if (!method || method === 'OPTIONS') return null
  const target = text(root, 'http.target')
  const path = text(root, 'url.path') || target.split('?')[0]
  // The standard attribute has its values redacted; prefer the unredacted one when the backend supplies it.
  const query = (text(root, 'url.query.raw') || text(root, 'url.query')).replace(/^\?/, '') || target.split('?')[1] || ''
  const route = text(root, 'http.route')
  const status = Number(text(root, 'http.response.status_code', 'http.status_code'))
  return {
    id: root.traceId, method,
    route: route ? `/${route}`.replace(/\/+/g, '/') : collapsePath(path),
    path, query,
    status: Number.isFinite(status) && status > 0 ? status : null,
    ms: round(root.endMs - root.startMs), startedAt: Math.round(root.startMs),
    aborted: root.attributes['http.client_aborted'] === true,
    db: others.filter(isQuery).map((s) => toDbCall(s, root.startMs)).sort((a, b) => a.offsetMs - b.offsetMs),
  }
}

/**
 * Collects the backend's traces into requests while a recording is running.
 *
 * A request's queries finish before the request does, so they arrive first or together with it.
 * Spans are held per trace until the request span turns up, then filed as one request.
 */
export function createRecorder(onStop: (recording: Recording) => void, graceMs = 6000) {
  let active: Active | null = null
  let spansSeen = 0
  let lastSpanAt: number | null = null

  function ingest(spans: Span[]): void {
    spansSeen += spans.length
    if (spans.length) lastSpanAt = Date.now()
    if (!active) return
    const { pending, byTrace, recording } = active
    for (const span of spans) {
      const filed = byTrace.get(span.traceId)
      if (filed) {
        // A straggler from a request already filed.
        if (isQuery(span)) filed.db.push(toDbCall(span, filed.startedAt))
        continue
      }
      pending.set(span.traceId, [...(pending.get(span.traceId) ?? []), span])
    }
    for (const [traceId, held] of pending) {
      const root = held.find((s) => s.kind === SPAN_KIND_SERVER && !held.some((p) => p.spanId === s.parentId))
      if (!root) continue
      pending.delete(traceId)
      const request = toRequest(root, held.filter((s) => s !== root))
      if (!request) continue
      // Only requests made while recording: not ones already under way at Record, nor ones after Stop.
      if (request.startedAt < recording.startedAt || (active.stoppedAt !== null && request.startedAt > active.stoppedAt)) continue
      byTrace.set(traceId, request)
      recording.items.push(request)
    }
  }

  return {
    ingest,
    start(projectId: string, name: string): Recording {
      if (active) throw new Error(active.stoppedAt === null ? 'A recording is already running. Stop it first.' : 'The last recording is still being finished. Try again in a moment.')
      const recording: Recording = { id: `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, projectId, name, startedAt: Date.now(), endedAt: null, requests: 0, items: [] }
      active = { recording, pending: new Map(), byTrace: new Map(), stoppedAt: null }
      return recording
    },
    /**
     * Ends the recording. The backend sends its traces in batches every few seconds, so the last
     * requests before Stop may not have arrived yet: wait for one more batch before closing the file.
     */
    async stop(): Promise<Recording> {
      if (!active || active.stoppedAt !== null) throw new Error('No recording is running.')
      const finishing = active
      finishing.stoppedAt = Date.now()
      await new Promise((resolve) => setTimeout(resolve, graceMs))
      const { recording } = finishing
      active = null
      recording.endedAt = finishing.stoppedAt
      recording.items.sort((a, b) => a.startedAt - b.startedAt)
      recording.requests = recording.items.length
      onStop(recording)
      return recording
    },
    status(): Pick<RecorderStatus, 'active' | 'spansSeen' | 'lastSpanAt'> {
      if (!active) return { active: null, spansSeen, lastSpanAt }
      const { items, ...info } = active.recording
      return {
        spansSeen, lastSpanAt,
        active: {
          ...info, finishing: active.stoppedAt !== null, requests: items.filter((r) => !r.aborted).length,
          aborted: items.filter((r) => r.aborted).length,
          queries: items.reduce((sum, r) => sum + r.db.length, 0),
          latest: items.slice(-8).reverse().map(({ method, path, ms, status }) => ({ method, path, ms, status })),
        },
      }
    },
  }
}

export type Recorder = ReturnType<typeof createRecorder>
