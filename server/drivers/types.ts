import type { QueryError, ResultSet, SchemaTable } from '../../shared/types.ts'

export interface DriverResult {
  resultSets: ResultSet[]
  rowsAffected: number | null
  messages: string[]
  /** Set when the run failed part-way. Whatever came back before the failure is still returned. */
  error?: QueryError
  /** True when the run ended because its AbortSignal fired. */
  stopped?: boolean
}

export interface Driver {
  query(sql: string, maxRows: number, signal?: AbortSignal): Promise<DriverResult>
  schema(): Promise<SchemaTable[]>
  close(): Promise<void>
}
