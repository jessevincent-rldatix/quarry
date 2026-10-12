import { create } from 'zustand'
import { editorBridge } from '@/components/editor/editorBridge'
import { api } from '@/lib/api'
import { MY_TEMPLATES, starterLibrary } from '@/lib/builtins'
import { prepareRun } from '@/lib/run'
import { localTables } from '@/lib/schema'
import { emptyBuilder } from '@/lib/sqlBuilder'
import { uid } from '@/lib/utils'
import { perform, workspaceNames } from './askActions'
import { startPersisting } from './persist'
import { isDirty } from './selectors'
import type { GridState, HistoryItem, Persisted, RunState, SavedQuery, State, Tab } from './types'

export * from './types'
export * from './selectors'

const blankTab = (n: number, connectionId: string): Tab => ({ id: uid(), title: `Untitled ${n}`, sql: '', queryId: null, vars: {}, connectionId })
export const emptyGrid = (): GridState => ({ mode: 'results', setIndex: 0, filter: '', sort: null, widths: {} })

export const useStore = create<State>((set, get) => ({
  ready: false,
  rev: 0,
  sync: 'saved',
  folders: [],
  queries: [],
  templates: [],
  history: [],
  tabs: [],
  activeTabId: '',
  activeConnectionId: 'demo',
  maxRows: 500,
  timeoutMs: 600_000,
  panel: 'library',
  connections: [],
  schemas: {},
  runs: {},
  grids: {},
  view: 'editor',
  dialog: null,
  paletteOpen: false,
  editorNonce: 0,
  builder: emptyBuilder(),
  templatePick: { id: 'builtin:preview', values: {} },
  ai: null,
  askOpen: false,
  askMessages: [],
  askBusy: false,

  async init() {
    const [saved, connections] = await Promise.all([api.loadStore() as Promise<(Partial<Persisted> & { rev?: number }) | null>, api.connections()])
    const known = (id: string | undefined) => (id && connections.some((c) => c.id === id) ? id : 'demo')
    if (saved) {
      // Tabs saved before connections were per-tab get the demo connection.
      const tabs = (saved.tabs ?? []).map((t) => ({ ...t, connectionId: known(t.connectionId) }))
      set({ ...saved, tabs, rev: saved.rev ?? 0, connections })
    } else {
      const { folders, queries } = starterLibrary()
      const first = queries[0]
      const tab: Tab = { id: uid(), title: first.name, sql: first.sql, queryId: first.id, vars: {}, connectionId: 'demo' }
      set({ folders, queries, tabs: [tab], activeTabId: tab.id, connections })
    }
    if (get().tabs.length === 0) get().newTab()
    const active = get().tabs.find((t) => t.id === get().activeTabId) ?? get().tabs[0]
    set({ activeTabId: active.id, activeConnectionId: active.connectionId, ready: true })
    startPersisting(useStore)
    void get().loadSchema(active.connectionId)
    void get().loadAi()
  },

  set: (patch) => set(patch),
  setDialog: (dialog) => set({ dialog }),

  async refreshConnections() {
    set({ connections: await api.connections() })
  },

  /** Points the active tab at another connection. */
  setConnection(id) {
    const { activeTabId } = get()
    set((s) => ({ activeConnectionId: id, tabs: s.tabs.map((t) => (t.id === activeTabId ? { ...t, connectionId: id } : t)) }))
    void get().loadSchema(id)
    void get().loadAi()
  },

  async loadSchema(id, force = false) {
    const existing = get().schemas[id]
    if (existing && !force && !existing.error) return
    set((s) => ({ schemas: { ...s.schemas, [id]: { loading: true, tables: existing?.tables ?? [] } } }))
    try {
      const tables = localTables(await api.schema(id), get().connections.find((c) => c.id === id))
      set((s) => ({ schemas: { ...s.schemas, [id]: { loading: false, tables } } }))
    } catch (err) {
      set((s) => ({ schemas: { ...s.schemas, [id]: { loading: false, tables: [], error: (err as Error).message } } }))
    }
  },

  newTab(init) {
    const numbers = get().tabs.map((t) => Number(/^Untitled (\d+)$/.exec(t.title)?.[1] ?? 0))
    const tab = { ...blankTab(Math.max(0, ...numbers) + 1, get().activeConnectionId), ...init }
    set((s) => ({ tabs: [...s.tabs, tab], view: 'editor' }))
    get().activateTab(tab.id)
    return tab.id
  },

  /**
   * Opens SQL that something other than typing produced (a preview, a template, a past run).
   * The caller says which connection it belongs to, and the tab is not "unsaved" until edited.
   */
  openSql({ sql, connectionId, title, vars }) {
    const known = get().connections.some((c) => c.id === connectionId)
    return get().newTab({ sql, openedSql: sql, ...(known ? { connectionId } : {}), ...(title ? { title } : {}), ...(vars ? { vars } : {}) })
  },

  activateTab(id) {
    const tab = get().tabs.find((t) => t.id === id)
    if (!tab) return
    const connectionId = get().connections.some((c) => c.id === tab.connectionId) ? tab.connectionId : 'demo'
    set((s) => ({ activeTabId: id, activeConnectionId: connectionId, view: 'editor', editorNonce: s.editorNonce + 1 }))
    void get().loadSchema(connectionId)
  },

  closeTab(id, discard = false) {
    const { tabs, activeTabId, queries } = get()
    const tab = tabs.find((t) => t.id === id)
    if (!tab) return
    const saved = queries.find((q) => q.id === tab.queryId)
    if (isDirty(tab, queries) && !discard) {
      set({
        dialog: {
          kind: 'confirm', danger: true, action: 'Close without saving',
          title: `Close "${tab.title}"?`,
          body: saved ? 'Your changes to this saved query have not been saved and will be lost.' : 'This query has not been saved and will be lost.',
          onConfirm: () => get().closeTab(id, true),
        },
      })
      return
    }
    const index = tabs.findIndex((t) => t.id === id)
    const rest = tabs.filter((t) => t.id !== id)
    const next = rest.length ? rest : [blankTab(1, get().activeConnectionId)]
    get().cancelRun(id)
    set((s) => {
      const { [id]: _run, ...runs } = s.runs
      const { [id]: _grid, ...grids } = s.grids
      return { tabs: next, runs, grids }
    })
    if (activeTabId === id) get().activateTab(next[Math.min(index, next.length - 1)].id)
  },

  closeTabs(ids, discard = false) {
    const { tabs, queries } = get()
    const closing = tabs.filter((t) => ids.includes(t.id))
    if (closing.length === 0) return
    const unsaved = closing.filter((t) => isDirty(t, queries))
    if (unsaved.length && !discard) {
      const named = unsaved.slice(0, 5).map((t) => `"${t.title}"`).join(', ')
      set({
        dialog: {
          kind: 'confirm', danger: true, action: 'Close without saving',
          title: closing.length === 1 ? `Close "${closing[0].title}"?` : `Close ${closing.length} tabs?`,
          body: `${unsaved.length === 1 ? 'One of them has' : `${unsaved.length} of them have`} changes that have not been saved and will be lost: ${named}${unsaved.length > 5 ? ` and ${unsaved.length - 5} more` : ''}.`,
          onConfirm: () => get().closeTabs(ids, true),
        },
      })
      return
    }
    for (const tab of closing) get().closeTab(tab.id, true)
  },

  updateTab(id, patch) {
    set((s) => ({ tabs: s.tabs.map((t) => (t.id === id ? { ...t, ...patch } : t)) }))
  },

  openQuery(id) {
    const query = get().queries.find((q) => q.id === id)
    if (!query) return
    const open = get().tabs.find((t) => t.queryId === id)
    if (open) {
      get().activateTab(open.id)
      return
    }
    const connectionId = get().connections.some((c) => c.id === query.connectionId) ? query.connectionId! : get().activeConnectionId
    get().newTab({ title: query.name, sql: query.sql, queryId: id, connectionId })
  },

  async runTab(tabId, selection) {
    const state = get()
    const tab = state.tabs.find((t) => t.id === tabId)
    const connection = state.connections.find((c) => c.id === tab?.connectionId)
    if (!tab || !connection || state.runs[tabId]?.running) return
    const prepared = prepareRun(tab, connection, selection)
    if (!prepared) return
    const { sql, lineOffset, errors, risk } = prepared
    const setRun = (run: RunState) => set((s) => ({ runs: { ...s.runs, [tabId]: run } }))

    if (errors.length) {
      setRun({ running: false, error: `Fix the variables first: ${errors.join('; ')}.`, sql, connectionId: connection.id })
      return
    }

    const execute = async (confirmed: boolean) => {
      const runId = uid()
      const at = Date.now()
      setRun({ ...get().runs[tabId], running: true, runId, startedAt: at })
      let run: RunState
      try {
        const response = await api.query({ connectionId: connection.id, sql, maxRows: get().maxRows, runId, confirmed, timeoutMs: get().timeoutMs })
        run = { running: false, response, sql, at, connectionId: connection.id, errorLine: response.error?.line ? response.error.line + lineOffset : undefined }
      } catch (err) {
        run = { running: false, error: (err as Error).message, sql, at, connectionId: connection.id }
      }
      const failure = run.error ?? run.response?.error?.message
      const rows = run.response ? (run.response.resultSets[0]?.rows.length ?? run.response.rowsAffected) : null
      const item: HistoryItem = {
        id: uid(), sql, connection: connection.name, connectionId: connection.id, at, ms: run.response?.ms ?? Date.now() - at, rows, error: failure,
        ...(run.response?.stopped ? { stopped: true } : {}),
      }
      // A closed tab has nowhere to show its result, but the run still belongs in history.
      set((s) => ({
        runs: s.tabs.some((t) => t.id === tabId) ? { ...s.runs, [tabId]: run } : s.runs,
        history: [item, ...s.history].slice(0, 300),
      }))
    }

    if (risk) {
      set({
        dialog: {
          kind: 'confirm', danger: true, action: 'Run it anyway', title: 'Check before running',
          body: `${risk}. It will run on ${connection.name}.`,
          onConfirm: () => void execute(true),
        },
      })
      return
    }
    await execute(false)
  },

  cancelRun(tabId) {
    const run = get().runs[tabId]
    if (run?.running && run.runId) void api.cancel(run.runId).catch(() => undefined)
  },

  setGrid(tabId, patch) {
    set((s) => ({ grids: { ...s.grids, [tabId]: { ...(s.grids[tabId] ?? emptyGrid()), ...patch } } }))
  },

  saveTab(tabId, details) {
    const tab = get().tabs.find((t) => t.id === tabId)
    if (!tab) return
    if (tab.queryId && !details) {
      get().updateQuery(tab.queryId, { sql: tab.sql, connectionId: tab.connectionId })
      return
    }
    if (!details) {
      set({ dialog: { kind: 'save', tabId } })
      return
    }
    const query: SavedQuery = { id: uid(), sql: tab.sql, pinned: false, updatedAt: Date.now(), connectionId: tab.connectionId, ...details }
    set((s) => ({ queries: [...s.queries, query] }))
    get().updateTab(tabId, { queryId: query.id, title: query.name })
  },

  updateQuery(id, patch) {
    set((s) => ({
      queries: s.queries.map((q) => (q.id === id ? { ...q, ...patch, updatedAt: Date.now() } : q)),
      tabs: patch.name ? s.tabs.map((t) => (t.queryId === id ? { ...t, title: patch.name! } : t)) : s.tabs,
    }))
  },

  deleteQuery(id) {
    set((s) => ({
      queries: s.queries.filter((q) => q.id !== id),
      tabs: s.tabs.map((t) => (t.queryId === id ? { ...t, queryId: null } : t)),
    }))
  },

  duplicateQuery(id) {
    const query = get().queries.find((q) => q.id === id)
    if (query) set((s) => ({ queries: [...s.queries, { ...query, id: uid(), name: `${query.name} copy`, pinned: false, updatedAt: Date.now() }] }))
  },

  /** Returns the existing folder when one already has this name, so duplicates cannot be made. */
  addFolder(name) {
    const existing = get().folders.find((f) => f.name.toLowerCase() === name.trim().toLowerCase())
    if (existing) return existing.id
    const folder = { id: uid(), name: name.trim(), open: true }
    set((s) => ({ folders: [...s.folders, folder] }))
    return folder.id
  },

  updateFolder(id, patch) {
    set((s) => ({ folders: s.folders.map((f) => (f.id === id ? { ...f, ...patch } : f)) }))
  },

  deleteFolder(id) {
    set((s) => ({
      folders: s.folders.filter((f) => f.id !== id),
      queries: s.queries.map((q) => (q.folderId === id ? { ...q, folderId: null } : q)),
    }))
  },

  saveTemplate(template) {
    const saved = { ...template, category: MY_TEMPLATES, builtin: false }
    set((s) => ({ templates: [...s.templates.filter((t) => t.id !== saved.id), saved], templatePick: { id: saved.id, values: {} } }))
  },

  deleteTemplate(id) {
    set((s) => ({ templates: s.templates.filter((t) => t.id !== id) }))
  },

  clearHistory: () => set({ history: [] }),

  async loadAi() {
    try {
      set({ ai: await api.aiStatus(get().activeConnectionId) })
    } catch { /* the AI panel shows its own setup prompt when this is missing */ }
  },

  async buildIndex() {
    const connectionId = get().activeConnectionId
    await api.buildIndex(connectionId)
    // The server builds in the background; poll until it settles or the user moves to another connection.
    const poll = async () => {
      if (get().activeConnectionId !== connectionId) return
      await get().loadAi()
      if (get().ai?.index.state === 'building') setTimeout(() => void poll(), 700)
    }
    await poll()
  },

  /** Replaces a tab's SQL. In the open editor this is one edit, so Ctrl Z brings the old text back. */
  replaceTabSql(tabId, sql) {
    if (!get().tabs.some((t) => t.id === tabId)) return false
    if (tabId === get().activeTabId && get().view === 'editor' && editorBridge.current) editorBridge.current.setText(sql)
    else get().updateTab(tabId, { sql })
    return true
  },

  async ask(question, include = {}) {
    const state = get()
    const tab = state.tabs.find((t) => t.id === state.activeTabId)
    const run = tab ? state.runs[tab.id] : undefined
    const history = state.askMessages.filter((m) => !m.failed).map(({ role, content }) => ({ role, content }))
    set((s) => ({ askBusy: true, askMessages: [...s.askMessages, { role: 'user', content: question, spoken: include.spoken }] }))
    try {
      const answer = await api.ask({
        connectionId: state.activeConnectionId,
        question,
        sql: include.sql ? tab?.sql : undefined,
        error: include.error ? run?.error ?? run?.response?.error?.message : undefined,
        spoken: include.spoken,
        workspace: workspaceNames(state),
        history,
      })
      // A spoken request to change the query is carried out, since there is no hand on the mouse.
      // It only ever changes the text; nothing is run.
      const applied = include.spoken && tab && answer.replacement !== undefined && get().replaceTabSql(tab.id, answer.replacement) ? tab.title : undefined
      // Things Ask was asked to do in the workbench are done whether typed or spoken; each says what became of it.
      const actions = (answer.actions ?? []).map((action) => perform(action, get))
      set((s) => ({ askMessages: [...s.askMessages, { role: 'assistant', content: answer.answer, tables: answer.tables, semantic: answer.semantic, applied, ...(actions.length ? { actions } : {}) }] }))
    } catch (err) {
      set((s) => ({ askMessages: [...s.askMessages, { role: 'assistant', content: (err as Error).message, failed: true }] }))
    } finally {
      set({ askBusy: false })
    }
  },
}))
