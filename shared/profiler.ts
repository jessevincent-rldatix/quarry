/** One query a request ran, as reported by the backend's own trace. */
export interface DbCall {
  /** Which database: mssql, snowflake, databricks... */
  store: string
  sql: string
  ms: number
  /** Milliseconds after the request started. */
  offsetMs: number
  /** Rows returned or affected. Null when the query did not finish. */
  rows: number | null
}

export interface RecordedRequest {
  /** The trace id, unique per request. */
  id: string
  method: string
  /** The route template, such as /api/trips/{id}. Falls back to the path with ids collapsed. */
  route: string
  path: string
  query: string
  status: number | null
  ms: number
  /** Epoch milliseconds. */
  startedAt: number
  /** The client gave up before the response (a cancelled fetch, a closed tab). */
  aborted: boolean
  db: DbCall[]
}

export interface RecordingInfo {
  id: string
  projectId: string
  name: string
  startedAt: number
  endedAt: number | null
  requests: number
}

export interface Recording extends RecordingInfo {
  items: RecordedRequest[]
}

export interface ProjectRoute { method: string; route: string }

export interface Project {
  id: string
  name: string
  /** Folder of the backend repo, used to find its swagger.json. */
  repoPath: string
  /** Where the backend runs, such as http://localhost:5177. Its live Swagger document is preferred over the file. */
  backendUrl?: string
  /** Where the routes were last read from, for showing in the app. */
  routesFrom?: string
  /** Every route the backend declares, for showing what a recording did not reach. */
  routes: ProjectRoute[]
  createdAt: number
}

export interface RecorderStatus {
  /** The recording in progress, if any. */
  active: (RecordingInfo & { /** Stop was pressed; the last batch of traces is being waited for. */ finishing: boolean; aborted: number; queries: number; latest: Pick<RecordedRequest, 'method' | 'path' | 'ms' | 'status'>[] }) | null
  /** Where the backend should send its traces. */
  grpcPort: number
  /** Why the trace listener is not available, when it is not. */
  grpcError?: string
  httpUrl: string
  /** Spans received since the server started, recording or not. Shows the backend is connected. */
  spansSeen: number
  lastSpanAt: number | null
}

export interface Stats { min: number; median: number; p95: number; max: number }

export type Flag = 'slow' | 'n+1' | 'db-heavy' | 'chatty' | 'errors' | 'slow-query'

export interface QuerySummary {
  fingerprint: string
  store: string
  /** One real example of the query text. */
  sql: string
  /** How many times a typical request runs it. */
  perCall: number
  /** The most times any single request ran it. */
  maxPerCall: number
  total: number
  ms: Stats
  rows: number | null
  nPlusOne: boolean
}

/** Identical requests (same method, path and query string) collapsed into one line. */
export interface Variant {
  path: string
  query: string
  count: number
  /** Fired again within a moment of itself, as React StrictMode does in development. */
  doubleFired: boolean
  ms: Stats
}

export interface EndpointSummary {
  key: string
  method: string
  route: string
  calls: number
  aborted: number
  errors: number
  ms: Stats
  /** Time a typical request spends waiting on the database, counting overlapping queries once. */
  dbMs: number
  /** dbMs as a fraction of the request, 0 to 1. */
  dbShare: number
  queriesPerCall: number
  variants: Variant[]
  queries: QuerySummary[]
  flags: Flag[]
  /** The slowest kept request, for the timeline view. */
  slowest: RecordedRequest
}

export interface RecordingSummary {
  endpoints: EndpointSummary[]
  requests: number
  aborted: number
  duplicates: number
  queries: number
  /** Declared routes this recording never hit. */
  notReached: ProjectRoute[]
}
