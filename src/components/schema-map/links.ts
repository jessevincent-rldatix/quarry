import type { ForeignKey, SchemaTable } from '@shared/types'
import { namedAfter } from '@/lib/sqlBuilder'

export const id = (schema: string, name: string) => `${schema}\u0000${name}`

export interface Link extends ForeignKey { from: string; to: string; guessed: boolean }

/**
 * Links between tables: real foreign keys, plus (optionally) guesses from column names for
 * databases that do not declare their relationships.
 */
export function findLinks(tables: SchemaTable[], withGuesses: boolean): Link[] {
  const byId = new Map(tables.map((t) => [id(t.schema, t.name), t]))
  const links: Link[] = []
  const seen = new Set<string>()
  for (const t of tables) {
    for (const fk of t.foreignKeys ?? []) {
      const to = id(fk.refSchema, fk.refTable)
      if (!byId.has(to)) continue
      links.push({ ...fk, from: id(t.schema, t.name), to, guessed: false })
      seen.add(`${id(t.schema, t.name)}|${fk.column}`)
    }
  }
  if (!withGuesses) return links
  for (const t of tables) {
    for (const other of tables) {
      if (other === t || other.kind === 'view' || t.kind === 'view') continue
      // Only a column named after the other table counts; a merely shared name is too weak a signal.
      const column = namedAfter(t, other)
      const keys = other.columns.filter((c) => c.pk)
      if (!column || keys.length !== 1) continue
      const key = `${id(t.schema, t.name)}|${column}`
      if (seen.has(key)) continue
      seen.add(key)
      links.push({ column, refSchema: other.schema, refTable: other.name, refColumn: keys[0].name, from: id(t.schema, t.name), to: id(other.schema, other.name), guessed: true })
    }
  }
  return links
}
