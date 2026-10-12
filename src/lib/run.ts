import { riskyWrite } from '@shared/readonly'
import type { Dialect } from '@shared/types'
import { renderSql } from './template'

export interface PreparedRun {
  /** The SQL as it will be sent, variables filled in. */
  sql: string
  /** Lines of the editor above the text being run, so an error line can be shown where it is. */
  lineOffset: number
  /** Variables that are missing or do not fit their type. A run with any of these does not start. */
  errors: string[]
  /** Why the run should be confirmed first, on a writable connection. */
  risk: string | null
}

/**
 * Everything decided about a run before it is sent: which text, with which values, and whether
 * it needs a second look. Returns null when there is nothing to run.
 */
export function prepareRun(
  tab: { sql: string; vars: Record<string, string> },
  connection: { dialect: Dialect; readOnly: boolean },
  selection?: { text: string; line: number },
): PreparedRun | null {
  const selected = Boolean(selection?.text.trim())
  const source = selected ? selection!.text : tab.sql
  if (!source.trim()) return null
  const { sql, errors } = renderSql(source, tab.vars, connection.dialect)
  // A read-only connection refuses writes outright, so there is nothing to confirm.
  const risk = errors.length || connection.readOnly ? null : riskyWrite(sql, connection.dialect)
  return { sql, lineOffset: selected ? selection!.line - 1 : 0, errors, risk }
}
