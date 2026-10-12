import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import type { AiSettings, AskRequest, ConnectionConfig, ConnectionInfo, ConnectionInput, QueryRequest, QueryResponse } from '../shared/types.ts'
import { readOnlyViolation, riskyWrite } from '../shared/readonly.ts'
import { createAi } from './ai.ts'
import { createSecrets } from './secrets.ts'
import { CANCELLED } from './drivers/common.ts'
import { openDriver } from './drivers/index.ts'
import type { Driver } from './drivers/types.ts'
import { addProfiler } from './profiler/routes.ts'
import { MAX_AUDIO_BYTES, createVoice } from './voice.ts'

// Keys for outside services (DEEPGRAM_API_KEY) are kept in a .env file beside package.json.
try { process.loadEnvFile() } catch { /* no .env file: those features stay switched off */ }

const PORT = Number(process.env.QUARRY_PORT ?? 4780)
const UI_PORT = Number(process.env.QUARRY_UI_PORT ?? 4781)
const DATA_DIR = process.env.QUARRY_DATA_DIR ?? path.join(os.homedir(), '.quarry')
const CONNECTIONS_FILE = path.join(DATA_DIR, 'connections.json')
const STORE_FILE = path.join(DATA_DIR, 'store.json')
const DEMO: ConnectionConfig = { id: 'demo', name: 'shop-demo', dialect: 'sqlite', builtin: true, readOnly: false }

fs.mkdirSync(DATA_DIR, { recursive: true })

// A fault in one query must never take down the server that holds every other connection.
process.on('uncaughtException', (err) => console.error('Unexpected error (server kept running):', err))
process.on('unhandledRejection', (err) => console.error('Unexpected rejection (server kept running):', err))

function readJson<T>(file: string, fallback: T): T {
  let text: string
  try {
    text = fs.readFileSync(file, 'utf8')
  } catch {
    return fallback
  }
  try {
    return JSON.parse(text) as T
  } catch {
    // Keep the unreadable file so nothing is lost when a fresh one is written over it.
    fs.copyFileSync(file, `${file}.unreadable-${Date.now()}`)
    return fallback
  }
}

/** Write to a temp file first so a crash mid-write cannot leave a half-written file. */
function writeJson(file: string, value: unknown): void {
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), { mode: 0o600 })
  fs.renameSync(tmp, file)
}

type Stored = ConnectionConfig & { password?: string }
let connections: Stored[] = readJson<Stored[]>(CONNECTIONS_FILE, [])
/** Passwords for this run of the server. Only written to disk for connections that opt in. */
const passwords = new Map<string, string>()
const secrets = createSecrets(DATA_DIR)
for (const c of connections) {
  const password = c.password ? secrets.reveal(c.password) : ''
  if (password) passwords.set(c.id, password)
}
const drivers = new Map<string, Promise<Driver>>()
const running = new Map<string, AbortController>()
const ai = createAi(DATA_DIR, secrets)
const voice = createVoice()

function saveConnections(): void {
  writeJson(CONNECTIONS_FILE, connections.map((c) => {
    const { password: _drop, ...rest } = c
    return c.savePassword && passwords.has(c.id) ? { ...rest, password: secrets.protect(passwords.get(c.id)!) } : rest
  }))
}

// Passwords saved as plain text by an older version are encrypted on first start.
if (connections.some((c) => c.password && secrets.isPlain(c.password))) saveConnections()

function findConnection(id: string): ConnectionConfig | undefined {
  return id === DEMO.id ? DEMO : connections.find((c) => c.id === id)
}

function toInfo(c: ConnectionConfig): ConnectionInfo {
  const { password: _drop, ...rest } = c as Stored
  return { ...rest, hasPassword: passwords.has(c.id) }
}

function closeDriver(id: string): void {
  const driver = drivers.get(id)
  drivers.delete(id)
  driver?.then((d) => d.close()).catch(() => undefined)
}

function getDriver(config: ConnectionConfig): Promise<Driver> {
  let driver = drivers.get(config.id)
  if (!driver) {
    driver = openDriver(config, passwords.get(config.id) ?? '')
    drivers.set(config.id, driver)
    // A failed connect must not be cached, or every later attempt would repeat the same error.
    driver.catch(() => drivers.delete(config.id))
  }
  return driver
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** No run may ask for longer than this, whatever the page sends. */
const MAX_TIMEOUT_MS = 6 * 60 * 60 * 1000

const timeLimitMessage = (ms: number) => {
  const seconds = Math.round(ms / 1000)
  const length = seconds % 60 === 0 && seconds >= 60 ? `${seconds / 60} minute${seconds === 60 ? '' : 's'}` : `${seconds} second${seconds === 1 ? '' : 's'}`
  return `Stopped at the ${length} time limit. Raise the limit in the toolbar and run again if the query needs longer.`
}

const app = new Hono()

// The API can run SQL, so it must only answer this app's own pages. A page on any other origin,
// including another port on this machine, is refused; and every change needs a header that a
// plain cross-site form or script request cannot send.
const ALLOWED_ORIGINS = new Set([PORT, UI_PORT].flatMap((port) => [`http://127.0.0.1:${port}`, `http://localhost:${port}`]))
app.use('/api/*', async (c, next) => {
  const host = (c.req.header('host') ?? '').split(':')[0]
  if (host !== '127.0.0.1' && host !== 'localhost') return c.json({ error: 'Forbidden host' }, 403)
  const origin = c.req.header('origin')
  if (origin && !ALLOWED_ORIGINS.has(origin)) return c.json({ error: 'Forbidden origin' }, 403)
  if (c.req.method !== 'GET') {
    const type = (c.req.header('content-type') ?? '').split(';')[0].trim().toLowerCase()
    if (type !== 'application/json') return c.json({ error: 'Expected application/json' }, 415)
    if (c.req.header('x-quarry-client') !== '1') return c.json({ error: 'Missing client header' }, 403)
  }
  await next()
})

// ── Connections ──────────────────────────────────────────────────────────────
app.get('/api/connections', (c) => c.json([DEMO, ...connections].map(toInfo)))

app.post('/api/connections', async (c) => {
  const input = await c.req.json<ConnectionInput>()
  if (!input.id || input.id === DEMO.id) return c.json({ error: 'Invalid connection id' }, 400)
  if (!input.name?.trim()) return c.json({ error: 'Give the connection a name' }, 400)
  const { password, ...config } = input
  const previous = connections.find((x) => x.id === config.id)
  const target = (x: ConnectionConfig) => [x.dialect, x.host, x.port, x.user, x.file, x.auth, x.keyFile].join('\u0000')
  const moved = previous !== undefined && target(previous) !== target(config)
  if (password !== undefined) {
    if (password) passwords.set(config.id, password)
    else passwords.delete(config.id)
  } else if (moved) {
    // A held password belongs to the server and login it was typed for; never send it somewhere new.
    passwords.delete(config.id)
  }
  connections = [...connections.filter((x) => x.id !== config.id), config]
  saveConnections()
  // Only reconnect when something about the connection itself changed, so runs in other tabs survive a rename.
  const { name: _a, savePassword: _b, color: _e, password: _p, ...before } = (previous ?? {}) as Stored
  const { name: _c, savePassword: _d, color: _f, ...after } = config
  if (password !== undefined || JSON.stringify(before) !== JSON.stringify(after)) closeDriver(config.id)
  return c.json(toInfo(config))
})

app.delete('/api/connections/:id', (c) => {
  const id = c.req.param('id')
  connections = connections.filter((x) => x.id !== id)
  passwords.delete(id)
  saveConnections()
  closeDriver(id)
  ai.dropIndex(id)
  return c.json({ ok: true })
})

app.post('/api/connections/:id/test', async (c) => {
  const config = findConnection(c.req.param('id'))
  if (!config) return c.json({ error: 'Connection not found' }, 404)
  try {
    const started = performance.now()
    const result = await (await getDriver(config)).query('SELECT 1', 1)
    if (result.error) throw new Error(result.error.message)
    return c.json({ ok: true, ms: Math.round(performance.now() - started) })
  } catch (err) {
    closeDriver(config.id)
    return c.json({ error: message(err) }, 400)
  }
})

app.get('/api/connections/:id/schema', async (c) => {
  const config = findConnection(c.req.param('id'))
  if (!config) return c.json({ error: 'Connection not found' }, 404)
  try {
    return c.json(await (await getDriver(config)).schema())
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

// ── Running queries ──────────────────────────────────────────────────────────
app.post('/api/query', async (c) => {
  const { connectionId, sql, maxRows, runId, confirmed, timeoutMs } = await c.req.json<QueryRequest>()
  const config = findConnection(connectionId)
  if (!config) return c.json({ error: 'Connection not found' }, 404)
  if (!sql?.trim()) return c.json({ error: 'Nothing to run' }, 400)
  if (config.readOnly) {
    const reason = readOnlyViolation(sql, config.dialect)
    if (reason) return c.json({ error: reason }, 400)
  } else if (!confirmed) {
    // The page asks before sending these. Checking here too means nothing can skip the question.
    const risk = riskyWrite(sql, config.dialect)
    if (risk) return c.json({ error: `${risk}. Confirm it before it runs.`, needsConfirmation: true }, 400)
  }
  const limit = Math.min(Math.max(Number(maxRows) || 500, 1), 100000)
  const controller = new AbortController()
  if (runId) running.set(runId, controller)
  const allowed = Number(timeoutMs) > 0 ? Math.min(Number(timeoutMs), MAX_TIMEOUT_MS) : 0
  let timedOut = false
  const timer = allowed ? setTimeout(() => { timedOut = true; controller.abort() }, allowed) : undefined
  const started = performance.now()
  try {
    const driver = await getDriver(config)
    const { stopped, ...result } = await driver.query(sql, limit, controller.signal)
    const response: QueryResponse = { ...result, ms: Math.round(performance.now() - started), maxRows: limit }
    if (stopped) {
      response.stopped = timedOut ? 'timeout' : 'user'
      if (timedOut) response.messages = result.messages.map((m) => (m === CANCELLED ? timeLimitMessage(allowed) : m))
    }
    return c.json(response)
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  } finally {
    clearTimeout(timer)
    if (runId) running.delete(runId)
  }
})

app.post('/api/cancel', async (c) => {
  const { runId } = await c.req.json<{ runId: string }>()
  running.get(runId)?.abort()
  return c.json({ ok: true })
})

// ── The library (queries, folders, templates, history, open tabs) ────────────
// `rev` goes up on every save. A window saving on top of a newer revision than it loaded is
// refused, so two windows cannot silently overwrite each other. The refusal names the browser tab that
// made the newer save, so a tab refused because of its own earlier save can simply go again.
app.get('/api/store', (c) => c.json(readJson<unknown>(STORE_FILE, null)))

app.put('/api/store', async (c) => {
  const body = await c.req.json<{ rev?: number; writer?: string }>()
  const current = readJson<{ rev?: number; writer?: string } | null>(STORE_FILE, null)
  const onDisk = current?.rev ?? 0
  if (current && (body.rev ?? 0) !== onDisk) return c.json({ error: 'changed-elsewhere', rev: onDisk, writer: current.writer }, 409)
  writeJson(STORE_FILE, { ...body, rev: onDisk + 1 })
  return c.json({ ok: true, rev: onDisk + 1 })
})

// ── AI ───────────────────────────────────────────────────────────────────────
const schemaFor = async (id: string) => {
  const config = findConnection(id)
  if (!config) throw new Error('Connection not found')
  return { config, tables: await (await getDriver(config)).schema() }
}

app.get('/api/ai/status/:id', (c) => c.json(ai.status(c.req.param('id'))))

app.post('/api/ai/settings', async (c) => {
  ai.saveSettings(await c.req.json<AiSettings & { token?: string }>())
  return c.json({ ok: true })
})

app.post('/api/ai/test', async (c) => {
  try {
    const answer = await ai.chat([{ role: 'user', content: 'Reply with the single word: ready' }])
    return c.json({ ok: true, answer: answer.slice(0, 80) })
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

app.post('/api/ai/index/:id', async (c) => {
  try {
    const { tables } = await schemaFor(c.req.param('id'))
    // Runs on after the response; the page polls the status for progress.
    void ai.build(c.req.param('id'), tables).catch(() => undefined)
    return c.json({ ok: true })
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

app.delete('/api/ai/index/:id', (c) => {
  ai.dropIndex(c.req.param('id'))
  return c.json({ ok: true })
})

app.post('/api/ai/search', async (c) => {
  try {
    const { connectionId, query } = await c.req.json<{ connectionId: string; query: string }>()
    const { tables } = await schemaFor(connectionId)
    return c.json(await ai.search(connectionId, tables, query, 12))
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

app.post('/api/ai/ask', async (c) => {
  try {
    const request = await c.req.json<AskRequest>()
    const { config, tables } = await schemaFor(request.connectionId)
    return c.json(await ai.ask(request, config.dialect, tables))
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

// ── Voice ────────────────────────────────────────────────────────────────────
app.get('/api/voice/status', (c) => c.json({ configured: voice.configured }))

app.post('/api/voice/transcribe', async (c) => {
  try {
    const { audio } = await c.req.json<{ audio: string }>()
    if (typeof audio !== 'string' || !audio) return c.json({ error: 'No audio' }, 400)
    return c.json({ text: await voice.transcribe(Buffer.from(audio, 'base64')) })
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

app.post('/api/voice/live', (c) => {
  try {
    return c.json({ id: voice.openLive() })
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

app.post('/api/voice/live/:id', async (c) => {
  try {
    const { audio, done } = await c.req.json<{ audio?: string; done?: boolean }>()
    const session = voice.live(c.req.param('id'))
    const pcm = typeof audio === 'string' && audio ? Buffer.from(audio, 'base64') : undefined
    if (pcm && pcm.length > MAX_AUDIO_BYTES) return c.json({ error: 'Too much audio at once' }, 400)
    const text = pcm ? session.send(pcm) : ''
    if (done) session.close()
    return c.json({ text })
  } catch (err) {
    return c.json({ error: message(err) }, 400)
  }
})

addProfiler(app, { dataDir: DATA_DIR, apiPort: PORT, grpcPort: Number(process.env.QUARRY_OTLP_PORT ?? 30317), stopGraceMs: Number(process.env.QUARRY_STOP_GRACE_MS ?? 6000) })

if (process.argv.includes('--serve')) {
  app.use('/*', serveStatic({ root: './dist' }))
  app.get('*', serveStatic({ path: './dist/index.html' }))
}

serve({ fetch: app.fetch, port: PORT, hostname: '127.0.0.1' }, () => {
  console.log(`Quarry API on http://127.0.0.1:${PORT}  (data in ${DATA_DIR})`)
})
