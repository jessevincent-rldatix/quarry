import type { Dialect, SchemaTable } from '@shared/types'
import { parseVars } from '@/lib/template'
import { useStore } from './index'
import type { SavedQuery, Tab } from './types'

export const useActiveTab = () => useStore((s) => s.tabs.find((t) => t.id === s.activeTabId))
export const useConnection = () => useStore((s) => s.connections.find((c) => c.id === s.activeConnectionId))
export const useDialect = (): Dialect => useConnection()?.dialect ?? 'sqlite'

const NO_TABLES: SchemaTable[] = []
export const useTables = () => useStore((s) => s.schemas[s.activeConnectionId]?.tables ?? NO_TABLES)

/** True when a tab has text the person typed that is not saved anywhere. */
export function isDirty(tab: Tab, queries: SavedQuery[]): boolean {
  const saved = tab.queryId ? queries.find((q) => q.id === tab.queryId) : undefined
  if (saved) return saved.sql !== tab.sql
  // SQL that a preview, template or past run put there can be had again; only edits to it are at risk.
  return tab.sql.trim() !== '' && tab.sql !== tab.openedSql
}

export const varCount = (sql: string) => parseVars(sql).length
