import fs from 'node:fs'
import { Worker } from 'node:worker_threads'
import type { ConnectionConfig, SchemaTable } from '../../shared/types.ts'
import { CANCELLED } from './common.ts'
import type { SqliteCommand, SqliteReply } from './sqliteWorker.ts'
import type { Driver, DriverResult } from './types.ts'

const RELOADED = 'Stopping a SQLite query restarts its in-memory database, so changes made since it was opened are gone.'

// A worker thread does not inherit the TypeScript loader the server was started with, so it sets it up itself.
const BOOT = `import('tsx/esm/api').then(({ register }) => { register(); return import(require('node:worker_threads').workerData.entry) })`

type Waiting = { resolve: (reply: SqliteReply) => void; reject: (err: Error) => void }

// ── SQLite (sql.js: the bundled demo, or a file loaded as a snapshot) ─────────
export async function sqliteDriver(config: ConnectionConfig): Promise<Driver> {
  // Fail now, with a clear message, rather than inside the worker.
  if (!config.builtin) fs.accessSync(config.file ?? '', fs.constants.R_OK)

  let worker: Worker | undefined
  let ready: Promise<void> | undefined
  let nextId = 1
  const waiting = new Map<number, Waiting>()

  const start = (): Promise<void> => {
    const fresh = new Worker(BOOT, { eval: true, workerData: { entry: new URL('./sqliteWorker.ts', import.meta.url).href, builtin: Boolean(config.builtin), file: config.file ?? '' } })
    worker = fresh
    ready = new Promise<void>((resolve, reject) => {
      fresh.on('message', (reply: SqliteReply) => {
        if (reply.id === 0) { resolve(); return }
        waiting.get(reply.id)?.resolve(reply)
        waiting.delete(reply.id)
      })
      const fail = (err: Error) => {
        reject(err)
        for (const w of waiting.values()) w.reject(err)
        waiting.clear()
        if (worker === fresh) { worker = undefined; ready = undefined }
      }
      fresh.on('error', fail)
      fresh.on('exit', (code) => fail(new Error(code === 0 ? 'The SQLite worker stopped.' : `The SQLite worker stopped (exit ${code}).`)))
    })
    return ready
  }

  const send = async (request: SqliteCommand): Promise<SqliteReply> => {
    await (ready ?? start())
    const id = nextId++
    return new Promise<SqliteReply>((resolve, reject) => {
      waiting.set(id, { resolve, reject })
      worker!.postMessage({ ...request, id })
    })
  }

  await start()

  return {
    async query(sql, maxRows, signal): Promise<DriverResult> {
      // Stopped before it began: nothing was running, so nothing had to be restarted.
      if (signal?.aborted) return { resultSets: [], rowsAffected: null, messages: [CANCELLED], stopped: true }
      const stopped: DriverResult = { resultSets: [], rowsAffected: null, messages: [CANCELLED, RELOADED], stopped: true }
      // SQLite cannot be interrupted from outside, so stopping means ending its thread and starting again.
      const onAbort = () => { void worker?.terminate() }
      signal?.addEventListener('abort', onAbort)
      try {
        const reply = await send({ kind: 'query', sql, maxRows })
        if (reply.error) return { resultSets: [], rowsAffected: null, messages: [], error: { message: reply.error } }
        return reply.result!
      } catch (err) {
        if (signal?.aborted) return stopped
        return { resultSets: [], rowsAffected: null, messages: [RELOADED], error: { message: (err as Error).message } }
      } finally {
        signal?.removeEventListener('abort', onAbort)
      }
    },
    async schema(): Promise<SchemaTable[]> {
      const reply = await send({ kind: 'schema' })
      if (reply.error) throw new Error(reply.error)
      return reply.schema!
    },
    async close() {
      const closing = worker
      worker = undefined
      ready = undefined
      await closing?.terminate()
    },
  }
}
