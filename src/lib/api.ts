import type {
  AiSettings, AiStatus, AskRequest, AskResponse, ConnectionInfo, ConnectionInput, QueryRequest, QueryResponse, SchemaMatch, SchemaTable,
} from '@shared/types'

/** An error response from the server, with its HTTP status and any extra fields it sent. */
export class ApiError extends Error {
  status: number
  body: Record<string, unknown>
  constructor(message: string, status: number, body: Record<string, unknown>) {
    super(message)
    this.status = status
    this.body = body
  }
}

export async function call<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response
  try {
    response = await fetch(`/api${path}`, {
      ...init,
      // The server refuses changes without this header, which a page on another site cannot send.
      headers: init?.body ? { 'content-type': 'application/json', 'x-quarry-client': '1' } : undefined,
    })
  } catch {
    throw new ApiError('Cannot reach the Quarry server. Is "npm run dev" still running?', 0, {})
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw new ApiError(body?.error ?? `Request failed (${response.status})`, response.status, body ?? {})
  return body as T
}

export const json = (method: string, value: unknown): RequestInit => ({ method, body: JSON.stringify(value) })

export const api = {
  connections: () => call<ConnectionInfo[]>('/connections'),
  saveConnection: (input: ConnectionInput) => call<ConnectionInfo>('/connections', json('POST', input)),
  deleteConnection: (id: string) => call<{ ok: true }>(`/connections/${id}`, json('DELETE', {})),
  testConnection: (id: string) => call<{ ok: true; ms: number }>(`/connections/${id}/test`, json('POST', {})),
  schema: (id: string) => call<SchemaTable[]>(`/connections/${id}/schema`),

  query: (request: QueryRequest) => call<QueryResponse>('/query', json('POST', request)),
  cancel: (runId: string) => call<{ ok: true }>('/cancel', json('POST', { runId })),

  loadStore: () => call<unknown>('/store'),
  saveStore: (value: unknown, keepalive = false) => call<{ ok: true; rev: number }>('/store', { ...json('PUT', value), keepalive }),

  aiStatus: (connectionId: string) => call<AiStatus>(`/ai/status/${connectionId}`),
  saveAiSettings: (settings: AiSettings & { token?: string }) => call<{ ok: true }>('/ai/settings', json('POST', settings)),
  testAi: () => call<{ ok: true; answer: string }>('/ai/test', json('POST', {})),
  buildIndex: (connectionId: string) => call<{ ok: true }>(`/ai/index/${connectionId}`, json('POST', {})),
  dropIndex: (connectionId: string) => call<{ ok: true }>(`/ai/index/${connectionId}`, json('DELETE', {})),
  aiSearch: (connectionId: string, query: string) => call<{ matches: SchemaMatch[]; semantic: boolean }>('/ai/search', json('POST', { connectionId, query })),
  ask: (request: AskRequest) => call<AskResponse>('/ai/ask', json('POST', request)),

  voiceStatus: () => call<{ configured: boolean }>('/voice/status'),
  /** Sends one spoken request, as a base64 WAV file, to be written down. */
  transcribe: (audio: string) => call<{ text: string }>('/voice/transcribe', json('POST', { audio })),
  /** Starts a stretch of live listening. */
  liveStart: () => call<{ id: string }>('/voice/live', json('POST', {})),
  /** Sends the next piece of sound (base64, 16-bit) and gets the words so far; `done` ends the listening. */
  liveSend: (id: string, audio: string, done = false) => call<{ text: string }>(`/voice/live/${id}`, json('POST', { audio, done })),
}
