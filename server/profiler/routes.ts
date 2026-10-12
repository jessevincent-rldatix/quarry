import type { Hono } from 'hono'
import type { RecorderStatus } from '../../shared/profiler.ts'
import { startGrpcListener } from './grpcListener.ts'
import { decodeJson, decodeProtobuf } from './otlp.ts'
import { createRecorder } from './recorder.ts'
import { createProfilerStorage } from './storage.ts'

const message = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Adds the profiler to the API: projects, recordings, and the two doors traces can come in by. */
export function addProfiler(app: Hono, options: { dataDir: string; apiPort: number; grpcPort: number; stopGraceMs: number }): void {
  const storage = createProfilerStorage(options.dataDir)
  const recorder = createRecorder((recording) => storage.saveRecording(recording), options.stopGraceMs)
  let grpcError: string | undefined
  void startGrpcListener(options.grpcPort, recorder.ingest).then((error) => { grpcError = error })

  // Traces over HTTP, for backends set to OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf. This path is
  // outside /api because the exporter cannot send the app's own headers; it only ever adds spans.
  app.post('/v1/traces', async (c) => {
    try {
      const type = (c.req.header('content-type') ?? '').toLowerCase()
      recorder.ingest(type.includes('json') ? decodeJson(await c.req.json()) : decodeProtobuf(new Uint8Array(await c.req.arrayBuffer())))
      return c.body(null, 200)
    } catch (err) {
      return c.json({ error: message(err) }, 400)
    }
  })

  const guarded = <T>(run: () => T) => {
    try { return { ok: true as const, value: run() } } catch (err) { return { ok: false as const, error: message(err) } }
  }

  app.get('/api/profiler/status', (c) => c.json({
    ...recorder.status(), grpcPort: options.grpcPort, grpcError, httpUrl: `http://127.0.0.1:${options.apiPort}`,
  } satisfies RecorderStatus))

  app.get('/api/profiler/projects', (c) => c.json({ projects: storage.projects() }))

  app.post('/api/profiler/projects', async (c) => {
    const input = await c.req.json<{ id?: string; name: string; repoPath: string; backendUrl?: string }>()
    try {
      return c.json(await storage.saveProject(input))
    } catch (err) {
      return c.json({ error: message(err) }, 400)
    }
  })

  app.delete('/api/profiler/projects/:id', (c) => {
    const result = guarded(() => storage.deleteProject(c.req.param('id')))
    return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 400)
  })

  app.get('/api/profiler/projects/:id/recordings', (c) => {
    const result = guarded(() => storage.recordings(c.req.param('id')))
    return result.ok ? c.json({ recordings: result.value }) : c.json({ error: result.error }, 400)
  })

  app.get('/api/profiler/projects/:id/recordings/:recording', (c) => {
    const result = guarded(() => storage.recording(c.req.param('id'), c.req.param('recording')))
    return result.ok ? c.json(result.value) : c.json({ error: 'That recording no longer exists.' }, 404)
  })

  app.post('/api/profiler/projects/:id/recordings/:recording', async (c) => {
    const { name } = await c.req.json<{ name: string }>()
    const result = guarded(() => storage.renameRecording(c.req.param('id'), c.req.param('recording'), name))
    return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 400)
  })

  app.delete('/api/profiler/projects/:id/recordings/:recording', (c) => {
    const result = guarded(() => storage.deleteRecording(c.req.param('id'), c.req.param('recording')))
    return result.ok ? c.json({ ok: true }) : c.json({ error: result.error }, 400)
  })

  app.post('/api/profiler/record/start', async (c) => {
    const { projectId, name } = await c.req.json<{ projectId: string; name: string }>()
    const result = guarded(() => {
      storage.project(projectId)
      const { items: _items, ...info } = recorder.start(projectId, name.trim() || new Date().toLocaleString())
      return info
    })
    return result.ok ? c.json(result.value) : c.json({ error: result.error }, 400)
  })

  app.post('/api/profiler/record/stop', async (c) => {
    try {
      const { items: _items, ...info } = await recorder.stop()
      return c.json(info)
    } catch (err) {
      return c.json({ error: message(err) }, 400)
    }
  })
}
