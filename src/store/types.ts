import type { AiStatus, ChatTurn, ConnectionInfo, QueryResponse, SchemaTable } from '@shared/types'
import type { Template } from '@/lib/builtins'
import type { BuilderState } from '@/lib/sqlBuilder'

export interface Folder { id: string; name: string; open: boolean }

export interface SavedQuery {
  id: string
  name: string
  sql: string
  folderId: string | null
  tags: string[]
  pinned: boolean
  updatedAt: number
  /** The connection the query was last saved against, so it reopens where it belongs. */
  connectionId?: string
}

export interface Tab {
  id: string
  title: string
  sql: string
  queryId: string | null
  vars: Record<string, string>
  /** Each tab runs against its own connection. */
  connectionId: string
  /** The SQL the tab was opened with when the app wrote it, so an untouched tab is not "unsaved". */
  openedSql?: string
}

export interface HistoryItem {
  id: string
  sql: string
  connection: string
  connectionId?: string
  at: number
  ms: number
  rows: number | null
  error?: string
  stopped?: boolean
}

export interface RunState {
  running: boolean
  runId?: string
  startedAt?: number
  response?: QueryResponse
  /** A failure before or instead of a response: unfilled variables, a refused query, no server. */
  error?: string
  /** Line in the editor that the database blamed, already adjusted for a run of selected text. */
  errorLine?: number
  sql?: string
  at?: number
  /** The connection that produced this result, which may no longer be the tab's. */
  connectionId?: string
}

/** How a tab's result grid is currently arranged. Kept per tab so switching tabs does not reset it. */
export interface GridState {
  mode: 'results' | 'chart' | 'messages'
  setIndex: number
  filter: string
  sort: { column: number; desc: boolean } | null
  /** Column widths, remembered per set of column names so a re-run keeps them. */
  widths: Record<string, number[]>
}

export type Panel = 'library' | 'schema' | 'history'
export type View = 'editor' | 'templates' | 'builder' | 'map' | 'profiler'
export type SyncState = 'saved' | 'saving' | 'failed' | 'conflict'

export type DialogState =
  | { kind: 'connections' }
  | { kind: 'ai-settings' }
  | { kind: 'save'; tabId: string }
  | { kind: 'details'; queryId: string }
  | { kind: 'template'; template?: Template; sql?: string }
  /** `onSubmit` refuses a value by returning `{ error }`; anything else it returns is ignored and the dialog closes. */
  | { kind: 'prompt'; title: string; label: string; value: string; onSubmit: (value: string) => { error: string } | void }
  | { kind: 'confirm'; title: string; body: string; action: string; danger?: boolean; onConfirm: () => void }
  | { kind: 'preview'; sql: string; errors?: string[] }
  | null

/** The part of the state written to disk. */
export interface Persisted {
  folders: Folder[]
  queries: SavedQuery[]
  templates: Template[]
  history: HistoryItem[]
  tabs: Tab[]
  activeTabId: string
  maxRows: number
  /** Longest a run may take before the server stops it; 0 for no limit. */
  timeoutMs: number
  panel: Panel
}

export const PERSISTED: (keyof Persisted)[] = ['folders', 'queries', 'templates', 'history', 'tabs', 'activeTabId', 'maxRows', 'timeoutMs', 'panel']

export interface AskMessage extends ChatTurn {
  /** Tables whose definitions were given to the model for this answer. */
  tables?: string[]
  semantic?: boolean
  failed?: boolean
  /** The question was spoken to "Hey Quarry". */
  spoken?: boolean
  /** Title of the tab whose query this answer replaced. */
  applied?: string
  /** What Quarry did in the workbench because of this answer, and what it could not. */
  actions?: { ok: boolean; text: string }[]
}

export interface State extends Persisted {
  ready: boolean
  /** Revision of the saved library this window last loaded or wrote. */
  rev: number
  sync: SyncState
  connections: ConnectionInfo[]
  activeConnectionId: string
  schemas: Record<string, { loading: boolean; tables: SchemaTable[]; error?: string }>
  runs: Record<string, RunState>
  grids: Record<string, GridState>
  view: View
  dialog: DialogState
  paletteOpen: boolean
  /** Bumped to ask the editor to take focus after an outside change. */
  editorNonce: number
  builder: BuilderState
  templatePick: { id: string; values: Record<string, string> }
  ai: AiStatus | null
  askOpen: boolean
  askMessages: AskMessage[]
  askBusy: boolean

  init: () => Promise<void>
  set: (patch: Partial<State>) => void
  setDialog: (dialog: DialogState) => void
  refreshConnections: () => Promise<void>
  setConnection: (id: string) => void
  loadSchema: (id: string, force?: boolean) => Promise<void>

  newTab: (init?: Partial<Tab>) => string
  openSql: (init: { sql: string; connectionId: string; title?: string; vars?: Record<string, string> }) => string
  activateTab: (id: string) => void
  closeTab: (id: string, discard?: boolean) => void
  /** Closes several tabs, asking once if any of them holds unsaved work. */
  closeTabs: (ids: string[], discard?: boolean) => void
  updateTab: (id: string, patch: Partial<Tab>) => void
  openQuery: (id: string) => void
  runTab: (tabId: string, selection?: { text: string; line: number }) => Promise<void>
  cancelRun: (tabId: string) => void
  setGrid: (tabId: string, patch: Partial<GridState>) => void

  saveTab: (tabId: string, details?: { name: string; folderId: string | null; tags: string[] }) => void
  updateQuery: (id: string, patch: Partial<SavedQuery>) => void
  deleteQuery: (id: string) => void
  duplicateQuery: (id: string) => void
  addFolder: (name: string) => string
  updateFolder: (id: string, patch: Partial<Folder>) => void
  deleteFolder: (id: string) => void
  saveTemplate: (template: Template) => void
  deleteTemplate: (id: string) => void
  clearHistory: () => void

  loadAi: () => Promise<void>
  buildIndex: () => Promise<void>
  replaceTabSql: (tabId: string, sql: string) => boolean
  ask: (question: string, include?: { sql?: boolean; error?: boolean; spoken?: boolean }) => Promise<void>
}
