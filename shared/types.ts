export type Dialect = 'sqlite' | 'mssql' | 'postgres' | 'mysql' | 'snowflake' | 'databricks'

/** How a Snowflake connection signs in. */
export type SnowflakeAuth = 'password' | 'sso' | 'keypair'

export interface ConnectionConfig {
  id: string
  name: string
  dialect: Dialect
  /** Demo database that ships with the app; cannot be edited or removed. */
  builtin?: boolean
  /** The server. For Snowflake the account identifier; for Databricks the workspace host. */
  host?: string
  port?: number
  /** The database. For Databricks, the catalog. */
  database?: string
  user?: string
  /** Snowflake and Databricks: the schema that names without one are looked up in. */
  schema?: string
  /** Snowflake: the warehouse that runs the queries. */
  warehouse?: string
  /** Snowflake: the role to act as. Blank for the login's default. */
  role?: string
  /** Snowflake: password or access token (the default), single sign-on in the browser, or a key pair. */
  auth?: SnowflakeAuth
  /** Snowflake key pair: path to the private key file. Its passphrase, if any, is kept as the password. */
  keyFile?: string
  /** Databricks: the SQL warehouse's HTTP path, or just its id. The access token is kept as the password. */
  httpPath?: string
  /** SQLite only: path to a database file, loaded as a read-only snapshot. */
  file?: string
  encrypt?: boolean
  trustServerCertificate?: boolean
  readOnly: boolean
  /** Write the password to the local data folder. Off by default: it is then kept in memory only. */
  savePassword?: boolean
  /** A colour painted on this connection's tabs and Run button, to mark databases that need care. */
  color?: ConnectionColor
}

export const CONNECTION_COLORS = ['red', 'amber', 'green', 'blue', 'violet'] as const
export type ConnectionColor = (typeof CONNECTION_COLORS)[number]

/** What the browser sees: never includes the password itself. */
export interface ConnectionInfo extends ConnectionConfig {
  hasPassword: boolean
}

export interface ConnectionInput extends ConnectionConfig {
  /** Omitted = keep the password already held for this connection. */
  password?: string
}

export interface SchemaColumn {
  name: string
  type: string
  nullable: boolean
  pk: boolean
}

export interface SchemaTable {
  schema: string
  name: string
  kind: 'table' | 'view'
  columns: SchemaColumn[]
  foreignKeys?: ForeignKey[]
}

/** `column` in this table points at `refColumn` of another table. */
export interface ForeignKey {
  column: string
  refSchema: string
  refTable: string
  refColumn: string
}

export type Cell = string | number | boolean | null

/** What a column holds, whatever the database calls its type. Set by each driver where it can tell. */
export type ColumnKind = 'integer' | 'decimal' | 'float' | 'bool' | 'date' | 'json' | 'binary' | 'text'

export interface ResultColumn {
  name: string
  /** The database's own name for the type; blank when it does not report one. */
  type: string
  /** Marks columns whose values are numbers even when they arrive as text (bigint, decimal). */
  numeric?: boolean
  kind?: ColumnKind
}

export interface ResultSet {
  columns: ResultColumn[]
  rows: Cell[][]
  /** True when the row limit cut the result short. */
  truncated: boolean
}

export interface QueryError {
  message: string
  /** 1-based line in the text that was run, when the database reported one. */
  line?: number
}

export interface QueryResponse {
  resultSets: ResultSet[]
  rowsAffected: number | null
  ms: number
  messages: string[]
  /** Set when the run failed part-way; results and messages from before the failure are still present. */
  error?: QueryError
  /** Set when the run was cut short: by the Stop button, or by the time limit. */
  stopped?: 'user' | 'timeout'
  /** The row limit this run used. */
  maxRows: number
}

export interface QueryRequest {
  connectionId: string
  sql: string
  maxRows: number
  /** Chosen by the client so the run can be stopped with /api/cancel. */
  runId: string
  /** The person has seen and accepted the warning for a risky write (see `riskyWrite`). */
  confirmed?: boolean
  /** Stop the run after this long. 0 or absent means no limit. */
  timeoutMs?: number
}

export interface ApiError {
  error: string
}

// ── AI ───────────────────────────────────────────────────────────────────────
export interface AiSettings {
  /** Databricks workspace host, without the scheme. */
  host: string
  chatEndpoint: string
  embedEndpoint: string
  /** Write the token to the local data folder. Off: it is kept in memory only. */
  saveToken: boolean
}

export interface IndexStatus {
  state: 'none' | 'building' | 'ready' | 'error'
  items: number
  done: number
  builtAt?: number
  model?: string
  error?: string
}

export interface AiStatus {
  settings: AiSettings
  hasToken: boolean
  configured: boolean
  index: IndexStatus
}

export interface SchemaMatch {
  kind: 'table' | 'column'
  schema: string
  table: string
  column?: string
  type?: string
  score: number
}

export interface ChatTurn {
  role: 'user' | 'assistant'
  content: string
}

export interface AskRequest {
  connectionId: string
  question: string
  /** The editor text, when the user wants it considered. */
  sql?: string
  /** The last error, when asking for a fix. */
  error?: string
  /** The question was spoken and transcribed, so a word or two may have been misheard. */
  spoken?: boolean
  /** What is open and saved in the workbench, by name, so the model can be asked to open or show things. */
  workspace?: AskWorkspace
  history: ChatTurn[]
}

/** The names the model may refer to in an action. Names only: no SQL and no rows. */
export interface AskWorkspace {
  queries: string[]
  templates: string[]
  tabs: string[]
  connections: string[]
}

export type AskActionKind =
  | 'open-query' | 'open-template' | 'preview-table' | 'use-connection' | 'switch-tab' | 'show'
  | 'new-tab' | 'close-tab' | 'close-all-tabs' | 'run' | 'format' | 'save'

/** Something the model asks Quarry to do. `name` is empty for actions that name nothing. */
export interface AskAction {
  kind: AskActionKind
  name: string
}

export interface AskResponse {
  answer: string
  /** The tables whose definitions were given to the model. */
  tables: string[]
  /** False when retrieval fell back to word matching because there is no index. */
  semantic: boolean
  /** Set when the answer is a changed version of the editor's query: the complete new query. */
  replacement?: string
  /** Things the model asked Quarry to do, in order. */
  actions?: AskAction[]
}
