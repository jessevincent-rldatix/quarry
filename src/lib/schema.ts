import type { ConnectionConfig, SchemaTable } from '@shared/types'
import { tableParts } from './sqlBuilder'

/**
 * The tables as the app names them. On MySQL a "schema" is the database itself, so tables of the
 * database the connection is in are shown bare, like tables of dbo or public elsewhere. On
 * Snowflake and Databricks the same goes for the schema the connection names, which is the one
 * the session looks bare names up in.
 */
export function localTables(tables: SchemaTable[], connection: Pick<ConnectionConfig, 'dialect' | 'database' | 'schema'> | undefined): SchemaTable[] {
  const cloud = connection?.dialect === 'snowflake' || connection?.dialect === 'databricks'
  const home = connection?.dialect === 'mysql' ? connection.database : cloud ? connection?.schema?.trim() : undefined
  if (!home) return tables
  // Both cloud databases match a bare name whatever its case.
  const bare = (schema: string) => (schema === home || (cloud && schema.toLowerCase() === home.toLowerCase()) ? '' : schema)
  return tables.map((t) => ({ ...t, schema: bare(t.schema), foreignKeys: t.foreignKeys?.map((fk) => ({ ...fk, refSchema: bare(fk.refSchema) })) }))
}

export interface SchemaGroup { schema: string; tables: SchemaTable[] }

/**
 * Tables gathered under the schema they belong to ("arbiter", "cartographer"), in the order the
 * schemas first appear. Tables with no schema to their name come first, as a group named ''.
 */
export function groupBySchema(tables: SchemaTable[]): SchemaGroup[] {
  const groups = new Map<string, SchemaTable[]>()
  for (const table of tables) {
    // The same rule that decides whether a table is written with its schema decides whether it is filed under one.
    const schema = tableParts(table).length > 1 ? table.schema : ''
    groups.set(schema, [...(groups.get(schema) ?? []), table])
  }
  const found = [...groups].map(([schema, list]) => ({ schema, tables: list }))
  return [...found.filter((g) => g.schema === ''), ...found.filter((g) => g.schema !== '')]
}
