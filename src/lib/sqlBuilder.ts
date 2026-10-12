import { DEFAULT_SCHEMAS, backslashEscapes, boolLiteral, dateLiteral, identPart, likeOperator, nextDay, parseDate, quoteText, rowLimit, textType, valueKind } from '@shared/dialect'
import type { Dialect, SchemaTable } from '@shared/types'

export { identPart } from '@shared/dialect'

export const OPERATORS = [
  { id: 'eq', label: 'equals' },
  { id: 'ne', label: 'does not equal' },
  { id: 'gt', label: 'greater than' },
  { id: 'ge', label: 'at least' },
  { id: 'lt', label: 'less than' },
  { id: 'le', label: 'at most' },
  { id: 'contains', label: 'contains' },
  { id: 'starts', label: 'starts with' },
  { id: 'in', label: 'is one of' },
  { id: 'null', label: 'is empty' },
  { id: 'notnull', label: 'is not empty' },
] as const
export type OperatorId = (typeof OPERATORS)[number]['id']

export interface BuilderFilter {
  id: string
  column: string
  op: OperatorId
  value: string
}

/** One joined table: `from` is a column of a table already in the query, `to` a column of this one. */
export interface BuilderJoin {
  id: string
  table: string
  from: string
  to: string
}

export interface BuilderState {
  table: string
  columns: string[]
  joins: BuilderJoin[]
  filters: BuilderFilter[]
  groupBy: string
  sortBy: string
  sortDesc: boolean
  limit: string
}

export const emptyBuilder = (): BuilderState => ({
  table: '', columns: [], joins: [], filters: [], groupBy: '', sortBy: '', sortDesc: false, limit: '100',
})

/**
 * A table as "schema.name" parts. The default schema is left off so everyday names stay short.
 * Kept as parts, never a dotted string, because a name may itself contain a dot.
 */
export const tableParts = (t: SchemaTable): string[] => (t.schema && !DEFAULT_SCHEMAS.includes(t.schema) ? [t.schema, t.name] : [t.name])

/** Display and lookup key for a table: "ops.trips", or just "orders" in the default schema. */
export const tableKey = (t: SchemaTable) => tableParts(t).join('.')

/** A column or other single name. */
export const ident = (name: string, dialect: Dialect) => identPart(name, dialect)

/** A table reference, schema-qualified when the table is outside the default schema. */
export const tableRef = (t: SchemaTable, dialect: Dialect) => tableParts(t).map((p) => identPart(p, dialect)).join('.')

/** SQL for "the first rows of this table". */
export function previewSql(t: SchemaTable, dialect: Dialect, limit = 100): string {
  const { top, tail } = rowLimit(limit, dialect)
  return `SELECT ${top}*\nFROM ${tableRef(t, dialect)}${tail ? `\n${tail}` : ''};`
}

const NUMBER = /^-?\d+(\.\d+)?$/
const WHOLE = /^\d+$/
const TRUE = /^(true|t|yes|y|1)$/i
const FALSE = /^(false|f|no|n|0)$/i

/** A column reference inside the builder: the table's key plus the column name, kept apart. */
export const columnRef = (table: string, column: string) => `${table}\u0000${column}`
export const refTable = (ref: string) => ref.slice(0, ref.indexOf('\u0000'))
export const refColumn = (ref: string) => ref.slice(ref.indexOf('\u0000') + 1)

const sameTable = (t: SchemaTable, schema: string, name: string) => t.name === name && (t.schema === schema || (!t.schema && !schema))

/** The column of `child` that is named after `parent`, such as trips.vehicle_id for vehicles. */
export function namedAfter(child: SchemaTable, parent: SchemaTable): string | undefined {
  const name = parent.name.toLowerCase()
  const singular = name.replace(/ies$/, 'y').replace(/s$/, '')
  return child.columns.find((c) => [`${singular}_id`, `${singular}id`, `${name}_id`].includes(c.name.toLowerCase()))?.name
}

const singleKey = (t: SchemaTable) => {
  const keys = t.columns.filter((c) => c.pk)
  return keys.length === 1 ? keys[0].name : undefined
}

/**
 * The columns that join `other` to one of the tables already in the query. A declared foreign
 * key in either direction wins; failing that, a column named after the other table; failing
 * that, a non-key column both tables share. Null when nothing points to a join.
 */
export function suggestJoin(inQuery: SchemaTable[], other: SchemaTable): { from: string; to: string } | null {
  for (const t of inQuery) {
    const out = t.foreignKeys?.find((fk) => sameTable(other, fk.refSchema, fk.refTable))
    if (out) return { from: columnRef(tableKey(t), out.column), to: out.refColumn }
    const back = other.foreignKeys?.find((fk) => sameTable(t, fk.refSchema, fk.refTable))
    if (back) return { from: columnRef(tableKey(t), back.refColumn), to: back.column }
  }
  for (const t of inQuery) {
    const child = namedAfter(t, other)
    const otherKey = singleKey(other)
    if (child && otherKey) return { from: columnRef(tableKey(t), child), to: otherKey }
    const parent = namedAfter(other, t)
    const key = singleKey(t)
    if (parent && key) return { from: columnRef(tableKey(t), key), to: parent }
  }
  for (const t of inQuery) {
    const shared = t.columns.find((c) => !c.pk && other.columns.some((o) => o.name === c.name && !o.pk))
    if (shared) return { from: columnRef(tableKey(t), shared.name), to: shared.name }
  }
  return null
}

/** Whether a declared foreign key links `other` to any of the tables, in either direction. */
export const isRelated = (inQuery: SchemaTable[], other: SchemaTable) =>
  inQuery.some((t) => t.foreignKeys?.some((fk) => sameTable(other, fk.refSchema, fk.refTable)) || other.foreignKeys?.some((fk) => sameTable(t, fk.refSchema, fk.refTable)))

/**
 * The state with everything removed that no longer makes sense: joins to tables that are gone
 * or that have no columns chosen yet stay, but columns, filters, grouping and sorting that point
 * at a table no longer in the query are dropped, and a sort that grouping makes invalid is cleared.
 */
export function tidyBuilder(state: BuilderState, tables: SchemaTable[]): BuilderState {
  const known = new Set(tables.map(tableKey))
  const joins: BuilderJoin[] = []
  const inQuery = new Set([state.table])
  for (const join of state.joins) {
    // A table can appear once: joining it twice would need aliases the builder does not write.
    if (!known.has(join.table) || inQuery.has(join.table)) continue
    joins.push(inQuery.has(refTable(join.from)) ? join : { ...join, from: '' })
    inQuery.add(join.table)
  }
  const keep = (ref: string) => inQuery.has(refTable(ref))
  const groupBy = keep(state.groupBy) ? state.groupBy : ''
  // Once rows are counted by a column, only that column (or the count) can order them.
  const sortBy = keep(state.sortBy) && (!groupBy || state.sortBy === groupBy) ? state.sortBy : ''
  return { ...state, joins, columns: state.columns.filter(keep), filters: state.filters.filter((f) => keep(f.column)), groupBy, sortBy }
}

export interface BuiltQuery {
  sql: string
  /** Filter values that do not fit their column, in words. Those filters are left out of the SQL. */
  problems: string[]
}

export function buildQuery(input: BuilderState, tables: SchemaTable[], dialect: Dialect): BuiltQuery {
  const base = tables.find((t) => tableKey(t) === input.table)
  if (!base) return { sql: '', problems: [] }
  const problems: string[] = []
  const byKey = new Map(tables.map((t) => [tableKey(t), t]))
  // A join with a column still to be picked is not written, and nothing may refer to its table,
  // including a later join that hangs off it.
  let state = tidyBuilder(input, tables)
  for (;;) {
    const complete = state.joins.filter((j) => j.from && j.to)
    if (complete.length === state.joins.length) break
    for (const j of state.joins) if (!complete.includes(j)) problems.push(`Pick the columns that join ${j.table}, or it is left out`)
    state = tidyBuilder({ ...state, joins: complete }, tables)
  }
  const joins = state.joins

  const q = (name: string) => identPart(name, dialect)
  const tref = (key: string) => tableRef(byKey.get(key) ?? base, dialect)
  // Qualified only when a join makes the bare column name ambiguous.
  const col = (ref: string) => (joins.length ? `${tref(refTable(ref))}.${q(refColumn(ref))}` : q(refColumn(ref)))
  const typeOf = (ref: string) => byKey.get(refTable(ref))?.columns.find((c) => c.name === refColumn(ref))?.type ?? ''

  /** The value written for this column's type, or null (with a problem noted) when it does not fit. */
  const literal = (ref: string, raw: string): string | null => {
    const value = raw.trim()
    const kind = valueKind(typeOf(ref))
    const misfit = (what: string) => { problems.push(`${refColumn(ref)} is ${what}, and "${value}" is not`); return null }
    if (kind === 'bool') {
      if (TRUE.test(value)) return boolLiteral(true, dialect)
      if (FALSE.test(value)) return boolLiteral(false, dialect)
      return misfit('a yes/no column (use true or false)')
    }
    if (kind === 'number') return NUMBER.test(value) ? value : misfit('a number column')
    if (kind === 'date' || kind === 'datetime') return dateLiteral(value, dialect) ?? misfit('a date column (use YYYY-MM-DD)')
    return NUMBER.test(value) && kind !== 'text' && !/date|time|uuid|uniqueidentifier|json|xml/i.test(typeOf(ref)) ? value : quoteText(raw, dialect)
  }

  /** A whole day typed against a column that also holds a time: the day is a range, not one instant. */
  const wholeDay = (ref: string, value: string) => {
    const d = valueKind(typeOf(ref)) === 'datetime' ? parseDate(value) : null
    if (!d || d.time !== undefined) return null
    return { from: dateLiteral(value, dialect)!, to: dateLiteral(nextDay(d), dialect)! }
  }

  const compare = (ref: string, op: 'eq' | 'ne' | 'gt' | 'ge' | 'lt' | 'le', value: string): string | null => {
    const c = col(ref)
    const day = wholeDay(ref, value)
    if (day) {
      switch (op) {
        case 'eq': return `(${c} >= ${day.from} AND ${c} < ${day.to})`
        case 'ne': return `(${c} < ${day.from} OR ${c} >= ${day.to})`
        case 'gt': return `${c} >= ${day.to}`
        case 'ge': return `${c} >= ${day.from}`
        case 'lt': return `${c} < ${day.from}`
        case 'le': return `${c} < ${day.to}`
      }
    }
    const v = literal(ref, value)
    return v === null ? null : `${c} ${{ eq: '=', ne: '<>', gt: '>', ge: '>=', lt: '<', le: '<=' }[op]} ${v}`
  }

  // LIKE needs text on both sides, and the typed value must not act as a wildcard.
  const like = (ref: string, value: string, prefix: boolean) => {
    const c = col(ref)
    const kind = valueKind(typeOf(ref))
    const asText = kind === 'text' || typeOf(ref) === '' ? c
      : `CAST(${c} AS ${textType(dialect)})`
    const operator = likeOperator(dialect)
    if (dialect === 'mssql') {
      return `${asText} ${operator} ${quoteText(`${prefix ? '%' : ''}${value.replace(/[[%_]/g, (m) => `[${m}]`)}%`, dialect)}`
    }
    const needsEscape = /[%_\\]/.test(value)
    const pattern = `${prefix ? '%' : ''}${value.replace(/[%_\\]/g, (m) => `\\${m}`)}%`
    return `${asText} ${operator} ${quoteText(pattern, dialect)}${needsEscape ? ` ESCAPE '${backslashEscapes(dialect) ? '\\\\' : '\\'}'` : ''}`
  }

  const listItems = (value: string) => value.split(',').map((v) => v.trim()).filter(Boolean)
  const usable = (f: BuilderFilter) =>
    f.column !== '' && (f.op === 'null' || f.op === 'notnull' || (f.op === 'in' ? listItems(f.value).length > 0 : f.value.trim() !== ''))

  const conditions = state.filters.filter(usable).map((f): string | null => {
    const c = col(f.column)
    switch (f.op) {
      case 'contains': return like(f.column, f.value, true)
      case 'starts': return like(f.column, f.value, false)
      case 'in': {
        const items = listItems(f.value).map((v) => literal(f.column, v))
        return items.includes(null) ? null : `${c} IN (${items.join(', ')})`
      }
      case 'null': return `${c} IS NULL`
      case 'notnull': return `${c} IS NOT NULL`
      default: return compare(f.column, f.op, f.value)
    }
  }).filter((c): c is string => c !== null)

  const limit = WHOLE.test(state.limit.trim()) ? rowLimit(state.limit.trim(), dialect) : { top: '', tail: '' }

  let select: string
  if (state.groupBy) select = `${col(state.groupBy)}, COUNT(*) AS row_count`
  else if (state.columns.length === 0) select = '*'
  else select = state.columns.map(col).join(',\n       ')

  const lines = [`SELECT ${limit.top}${select}`, `FROM ${tableRef(base, dialect)}`]
  for (const j of joins) lines.push(`JOIN ${tref(j.table)}`, `  ON ${tref(refTable(j.from))}.${q(refColumn(j.from))} = ${tref(j.table)}.${q(j.to)}`)
  conditions.forEach((condition, i) => lines.push(`${i === 0 ? 'WHERE' : '  AND'} ${condition}`))

  if (state.groupBy) lines.push(`GROUP BY ${col(state.groupBy)}`)
  if (state.groupBy && !state.sortBy) lines.push('ORDER BY row_count DESC')
  else if (state.sortBy) lines.push(`ORDER BY ${col(state.sortBy)}${state.sortDesc ? ' DESC' : ''}`)
  if (limit.tail) lines.push(limit.tail)
  return { sql: `${lines.join('\n')};`, problems: [...new Set(problems)] }
}

export const buildSql = (state: BuilderState, tables: SchemaTable[], dialect: Dialect) => buildQuery(state, tables, dialect).sql
