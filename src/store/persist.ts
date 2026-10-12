import type { StoreApi } from 'zustand'
import { ApiError, api } from '@/lib/api'
import { uid } from '@/lib/utils'
import { PERSISTED, type State } from './types'

const WRITER_KEY = 'quarry.window'

/**
 * A name for this browser tab that outlives a reload. Every save carries it, so a save that is
 * refused because of this tab's own earlier save (the last-moment save of the page before a
 * reload, or a copy of the app left running by a development reload) can be told from one that
 * is refused because of another window.
 */
function writerId(): string {
  try {
    const kept = sessionStorage.getItem(WRITER_KEY)
    if (kept) return kept
    const made = uid()
    sessionStorage.setItem(WRITER_KEY, made)
    return made
  } catch {
    return uid()
  }
}

/** Stops the saving started by an earlier copy of this module, which a development reload leaves behind. */
const previous = () => window as unknown as { quarryStopPersisting?: () => void }

/**
 * Writes the library to disk shortly after it changes.
 *
 * Every save carries the revision this window last saw. If another window saved in between, the
 * server refuses and this window stops saving rather than overwrite the other one's work. If the
 * save in between was this tab's own, there is nothing to protect: it takes the new revision and
 * saves again.
 */
export function startPersisting(store: StoreApi<State>): void {
  const running = previous()
  running.quarryStopPersisting?.()
  const writer = writerId()
  let timer: ReturnType<typeof setTimeout> | undefined
  let dirty = false
  let saving = false
  let stopped = false

  const snapshot = () => {
    const state = store.getState()
    return { ...Object.fromEntries(PERSISTED.map((key) => [key, state[key]])), rev: state.rev, writer }
  }

  const save = async () => {
    if (stopped || saving || store.getState().sync === 'conflict') return
    saving = true
    dirty = false
    try {
      const { rev } = await api.saveStore(snapshot())
      store.setState({ rev, sync: dirty ? 'saving' : 'saved' })
    } catch (err) {
      const refused = err instanceof ApiError && err.status === 409
      dirty = true
      if (refused && err.body.writer === writer && typeof err.body.rev === 'number') store.setState({ rev: err.body.rev, sync: 'saving' })
      else store.setState({ sync: refused ? 'conflict' : 'failed' })
    } finally {
      saving = false
      if (dirty && store.getState().sync === 'saving') schedule()
    }
  }

  const schedule = () => {
    clearTimeout(timer)
    if (!stopped) timer = setTimeout(() => void save(), 400)
  }

  const unsubscribe = store.subscribe((state, previous) => {
    if (!PERSISTED.some((key) => state[key] !== previous[key])) return
    dirty = true
    if (state.sync !== 'conflict') {
      if (state.sync !== 'saving') store.setState({ sync: 'saving' })
      schedule()
    }
  })

  // A failed save is retried on the next change; this retries on a timer too, so it recovers on its own.
  const retry = setInterval(() => {
    if (store.getState().sync === 'failed') { store.setState({ sync: 'saving' }); void save() }
  }, 5000)

  // Flush edits made in the last moments before the window closes.
  const flush = () => {
    if (dirty && store.getState().sync !== 'conflict') void api.saveStore(snapshot(), true).catch(() => undefined)
  }
  window.addEventListener('pagehide', flush)

  running.quarryStopPersisting = () => {
    stopped = true
    clearTimeout(timer)
    clearInterval(retry)
    unsubscribe()
    window.removeEventListener('pagehide', flush)
  }
}
