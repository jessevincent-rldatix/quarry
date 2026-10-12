import type { Dialect, SchemaTable } from '@shared/types'
import { tableKey, tableRef } from './sqlBuilder'
import { quoteText } from './template'

export interface Template {
  id: string
  name: string
  description: string
  category: string
  /** `default` is used unless there is SQL written for the connected dialect. */
  sql: { default?: string } & Partial<Record<Dialect, string>>
  builtin?: boolean
  /** For databases where the query has to be written from the list of tables, not looked up. */
  build?: Partial<Record<Dialect, (tables: SchemaTable[]) => string>>
}

export const MY_TEMPLATES = 'My templates'

/** The SQL for a dialect, or null when the template does not support it. */
export function templateSql(template: Template, dialect: Dialect, tables: SchemaTable[] = []): string | null {
  const build = template.build?.[dialect]
  if (build) return tables.some((t) => t.kind === 'table') ? build(tables) : null
  return template.sql[dialect] ?? template.sql.default ?? null
}

/** SQLite keeps no row counts, so count each table. Exact, and slower on big files. */
const sqliteRowCounts = (tables: SchemaTable[]) =>
  `${tables.filter((t) => t.kind === 'table')
    .map((t, i) => `${i ? 'UNION ALL ' : ''}SELECT ${quoteText(tableKey(t), 'sqlite')} AS table_name, COUNT(*) AS row_count FROM ${tableRef(t, 'sqlite')}`)
    .join('\n')}\nORDER BY row_count DESC;`

const t = (id: string, category: string, name: string, description: string, sql: Template['sql'], build?: Template['build']): Template =>
  ({ id: `builtin:${id}`, category, name, description, sql, builtin: true, ...(build ? { build } : {}) })

export const BUILTIN_TEMPLATES: Template[] = [
  t('preview', 'Explore a table', 'Preview rows', 'The first rows of any table.', {
    default: 'SELECT *\nFROM {{table:ident}}\nLIMIT {{limit:number=100}};',
    mssql: 'SELECT TOP ({{limit:number=100}}) *\nFROM {{table:ident}};',
  }),
  t('find', 'Explore a table', 'Find rows by value', 'Rows where one column equals a value.', {
    default: 'SELECT *\nFROM {{table:ident}}\nWHERE {{column:ident}} = {{value}}\nLIMIT {{limit:number=100}};',
    mssql: 'SELECT TOP ({{limit:number=100}}) *\nFROM {{table:ident}}\nWHERE {{column:ident}} = {{value}};',
  }),
  t('counts', 'Explore a table', 'Value counts', 'How often each value of a column appears, most common first.', {
    default: 'SELECT {{column:ident}} AS value, COUNT(*) AS row_count\nFROM {{table:ident}}\nGROUP BY {{column:ident}}\nORDER BY row_count DESC;',
  }),
  t('range', 'Explore a table', 'Rows in a date range', 'Rows between two dates on a date column. The end date is not included.', {
    default: 'SELECT *\nFROM {{table:ident}}\nWHERE {{date_column:ident}} >= {{from:date}}\n  AND {{date_column:ident}} < {{to:date}}\nORDER BY {{date_column:ident}} DESC\nLIMIT {{limit:number=500}};',
    mssql: 'SELECT TOP ({{limit:number=500}}) *\nFROM {{table:ident}}\nWHERE {{date_column:ident}} >= {{from:date}}\n  AND {{date_column:ident}} < {{to:date}}\nORDER BY {{date_column:ident}} DESC;',
  }),
  t('search', 'Explore a table', 'Search a text column', 'Rows where a text column contains a phrase.', {
    // The cast lets the search work on numbers, dates and ids as well as text.
    default: "SELECT *\nFROM {{table:ident}}\nWHERE CAST({{column:ident}} AS text) LIKE '%' || {{phrase}} || '%'\nLIMIT {{limit:number=100}};",
    mssql: "SELECT TOP ({{limit:number=100}}) *\nFROM {{table:ident}}\nWHERE CAST({{column:ident}} AS nvarchar(max)) LIKE N'%' + {{phrase}} + N'%';",
    mysql: "SELECT *\nFROM {{table:ident}}\nWHERE CAST({{column:ident}} AS char) LIKE CONCAT('%', {{phrase}}, '%')\nLIMIT {{limit:number=100}};",
    postgres: "SELECT *\nFROM {{table:ident}}\nWHERE CAST({{column:ident}} AS text) ILIKE '%' || {{phrase}} || '%'\nLIMIT {{limit:number=100}};",
    snowflake: "SELECT *\nFROM {{table:ident}}\nWHERE CAST({{column:ident}} AS varchar) ILIKE '%' || {{phrase}} || '%'\nLIMIT {{limit:number=100}};",
    databricks: "SELECT *\nFROM {{table:ident}}\nWHERE CAST({{column:ident}} AS string) ILIKE concat('%', {{phrase}}, '%')\nLIMIT {{limit:number=100}};",
  }),
  t('in-list', 'Explore a table', 'Rows matching a list', 'Rows where a column is one of several values. Paste them comma-separated.', {
    default: 'SELECT *\nFROM {{table:ident}}\nWHERE {{column:ident}} IN ({{values:list}});',
  }),

  t('nulls', 'Data quality', 'Null count for a column', 'How many rows have no value in a column, out of the total.', {
    default: 'SELECT COUNT(*) AS total_rows,\n       SUM(CASE WHEN {{column:ident}} IS NULL THEN 1 ELSE 0 END) AS null_rows\nFROM {{table:ident}};',
  }),
  t('duplicates', 'Data quality', 'Duplicate values', 'Values of a column that appear more than once.', {
    default: 'SELECT {{column:ident}} AS value, COUNT(*) AS copies\nFROM {{table:ident}}\nGROUP BY {{column:ident}}\nHAVING COUNT(*) > 1\nORDER BY copies DESC;',
  }),
  t('orphans', 'Data quality', 'Orphaned rows', 'Child rows whose foreign key points at a parent row that does not exist.', {
    default: 'SELECT c.*\nFROM {{child_table:ident}} c\nLEFT JOIN {{parent_table:ident}} p\n  ON p.{{parent_key:ident}} = c.{{child_key:ident}}\nWHERE c.{{child_key:ident}} IS NOT NULL\n  AND p.{{parent_key:ident}} IS NULL;',
  }),
  t('profile', 'Data quality', 'Column profile', 'Row count, distinct values, smallest and largest value of a column.', {
    default: 'SELECT COUNT(*) AS total_rows,\n       COUNT(DISTINCT {{column:ident}}) AS distinct_values,\n       MIN({{column:ident}}) AS smallest,\n       MAX({{column:ident}}) AS largest\nFROM {{table:ident}};',
    // Postgres has no MIN or MAX for some types (uuid, for one), but it can sort them.
    postgres: 'SELECT COUNT(*) AS total_rows,\n       COUNT(DISTINCT {{column:ident}}) AS distinct_values,\n       (SELECT {{column:ident}} FROM {{table:ident}} WHERE {{column:ident}} IS NOT NULL ORDER BY 1 ASC LIMIT 1) AS smallest,\n       (SELECT {{column:ident}} FROM {{table:ident}} WHERE {{column:ident}} IS NOT NULL ORDER BY 1 DESC LIMIT 1) AS largest\nFROM {{table:ident}};',
    // SQL Server has no MIN or MAX for bit, but it can sort it.
    mssql: 'SELECT COUNT(*) AS total_rows,\n       COUNT(DISTINCT {{column:ident}}) AS distinct_values,\n       (SELECT TOP (1) {{column:ident}} FROM {{table:ident}} WHERE {{column:ident}} IS NOT NULL ORDER BY 1 ASC) AS smallest,\n       (SELECT TOP (1) {{column:ident}} FROM {{table:ident}} WHERE {{column:ident}} IS NOT NULL ORDER BY 1 DESC) AS largest\nFROM {{table:ident}};',
  }),

  t('find-column', 'Schema and size', 'Find a column by name', 'Every table that has a column whose name contains some text.', {
    default: "SELECT table_schema, table_name, column_name, data_type\nFROM information_schema.columns\nWHERE column_name LIKE '%' || {{name_contains}} || '%'\nORDER BY table_schema, table_name;",
    postgres: "SELECT table_schema, table_name, column_name, data_type\nFROM information_schema.columns\nWHERE column_name ILIKE '%' || {{name_contains}} || '%'\n  AND table_schema NOT IN ('pg_catalog', 'information_schema')\nORDER BY table_schema, table_name;",
    mssql: "SELECT TABLE_SCHEMA, TABLE_NAME, COLUMN_NAME, DATA_TYPE\nFROM INFORMATION_SCHEMA.COLUMNS\nWHERE COLUMN_NAME LIKE N'%' + {{name_contains}} + N'%'\nORDER BY TABLE_SCHEMA, TABLE_NAME;",
    mysql: "SELECT table_schema, table_name, column_name, data_type\nFROM information_schema.columns\nWHERE column_name LIKE CONCAT('%', {{name_contains}}, '%')\nORDER BY table_schema, table_name;",
    snowflake: "SELECT table_schema, table_name, column_name, data_type\nFROM information_schema.columns\nWHERE column_name ILIKE '%' || {{name_contains}} || '%'\n  AND table_schema <> 'INFORMATION_SCHEMA'\nORDER BY table_schema, table_name;",
    databricks: "SELECT table_schema, table_name, column_name, data_type\nFROM information_schema.columns\nWHERE column_name ILIKE concat('%', {{name_contains}}, '%')\n  AND table_schema <> 'information_schema'\nORDER BY table_schema, table_name;",
    sqlite: "SELECT m.name AS table_name, p.name AS column_name, p.type AS data_type\nFROM sqlite_master m\nJOIN pragma_table_info(m.name) p\nWHERE m.type IN ('table', 'view')\n  AND p.name LIKE '%' || {{name_contains}} || '%'\nORDER BY m.name;",
  }),
  t('row-counts', 'Schema and size', 'Row counts, all tables', 'Number of rows in every table, largest first. Approximate, except on SQLite. Databricks keeps no such count.', {
    mssql: 'SELECT s.name AS schema_name, t.name AS table_name, SUM(p.rows) AS row_count\nFROM sys.tables t\nJOIN sys.schemas s ON s.schema_id = t.schema_id\nJOIN sys.partitions p ON p.object_id = t.object_id AND p.index_id IN (0, 1)\nGROUP BY s.name, t.name\nORDER BY row_count DESC;',
    // pg_stat_user_tables lists materialized views too; only tables are wanted here.
    postgres: "SELECT s.schemaname AS schema_name, s.relname AS table_name, s.n_live_tup AS row_count\nFROM pg_stat_user_tables s\nJOIN pg_class c ON c.oid = s.relid\nWHERE c.relkind IN ('r', 'p')\nORDER BY s.n_live_tup DESC;",
    mysql: "SELECT table_schema, table_name, table_rows AS row_count\nFROM information_schema.tables\nWHERE table_type = 'BASE TABLE'\n  AND table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')\nORDER BY table_rows DESC;",
    snowflake: "SELECT table_schema, table_name, row_count\nFROM information_schema.tables\nWHERE table_type = 'BASE TABLE'\nORDER BY row_count DESC;",
  }, { sqlite: sqliteRowCounts }),
  t('table-sizes', 'Schema and size', 'Table sizes on disk', 'Space used by each table, largest first.', {
    mssql: 'SELECT s.name AS schema_name, t.name AS table_name,\n       CAST(SUM(a.total_pages) * 8 / 1024.0 AS decimal(18, 1)) AS total_mb\nFROM sys.tables t\nJOIN sys.schemas s ON s.schema_id = t.schema_id\nJOIN sys.partitions p ON p.object_id = t.object_id\nJOIN sys.allocation_units a ON a.container_id = p.partition_id\nGROUP BY s.name, t.name\nORDER BY total_mb DESC;',
    postgres: 'SELECT schemaname AS schema_name, relname AS table_name,\n       pg_size_pretty(pg_total_relation_size(relid)) AS total_size\nFROM pg_catalog.pg_statio_user_tables\nORDER BY pg_total_relation_size(relid) DESC;',
    mysql: "SELECT table_schema, table_name,\n       ROUND((data_length + index_length) / 1024 / 1024, 1) AS total_mb\nFROM information_schema.tables\nWHERE table_type = 'BASE TABLE'\n  AND table_schema NOT IN ('mysql', 'information_schema', 'performance_schema', 'sys')\nORDER BY (data_length + index_length) DESC;",
    snowflake: "SELECT table_schema, table_name,\n       ROUND(bytes / 1024 / 1024, 1) AS total_mb\nFROM information_schema.tables\nWHERE table_type = 'BASE TABLE'\nORDER BY bytes DESC;",
  }),
  t('running', 'Schema and size', 'Running queries', 'What is executing on the server right now.', {
    mssql: 'SELECT r.session_id, r.status, r.start_time, r.total_elapsed_time AS elapsed_ms, r.blocking_session_id, t.text AS sql_text\nFROM sys.dm_exec_requests r\nCROSS APPLY sys.dm_exec_sql_text(r.sql_handle) t\nWHERE r.session_id <> @@SPID\nORDER BY r.total_elapsed_time DESC;',
    postgres: "SELECT pid, state, query_start, now() - query_start AS running_for, query\nFROM pg_stat_activity\nWHERE state <> 'idle' AND pid <> pg_backend_pid()\nORDER BY query_start;",
    mysql: "SELECT id, user, db, command, time AS seconds, state, info AS sql_text\nFROM information_schema.processlist\nWHERE command NOT IN ('Sleep', 'Daemon')\n  AND id <> CONNECTION_ID()\nORDER BY time DESC;",
    snowflake: "SELECT query_id, user_name, warehouse_name, execution_status, start_time, total_elapsed_time AS elapsed_ms, query_text\nFROM TABLE(information_schema.query_history())\nWHERE execution_status IN ('RUNNING', 'QUEUED', 'BLOCKED', 'RESUMING_WAREHOUSE')\nORDER BY start_time;",
  }),
]

/** The library a new install starts with: a few queries against the bundled demo database. */
export function starterLibrary() {
  const now = Date.now()
  const folders = [
    { id: 'starter-sales', name: 'Sales', open: true },
    { id: 'starter-checks', name: 'Data checks', open: false },
  ]
  const q = (id: string, folderId: string, name: string, tags: string[], pinned: boolean, sql: string) =>
    ({ id: `starter-${id}`, folderId, name, tags, pinned, sql, updatedAt: now })
  const queries = [
    q('orders-by-status', 'starter-sales', 'Orders by status', ['reporting'], false,
      '-- Orders grouped by status for a date range\nSELECT o.status,\n       COUNT(*)             AS orders,\n       ROUND(SUM(o.total), 2) AS revenue,\n       MAX(o.placed_at)     AS latest\nFROM orders o\nWHERE o.placed_at >= {{since:date=2026-01-01}}\n  AND o.total >= {{min_total:number=0}}\nGROUP BY o.status\nORDER BY revenue DESC;'),
    q('revenue-by-month', 'starter-sales', 'Revenue by month', ['reporting', 'weekly'], true,
      "SELECT substr(placed_at, 1, 7) AS month,\n       COUNT(*)                AS orders,\n       ROUND(SUM(total), 2)    AS revenue\nFROM orders\nWHERE status NOT IN ('cancelled', 'refunded')\nGROUP BY month\nORDER BY month;"),
    q('top-customers', 'starter-sales', 'Top customers', ['reporting'], false,
      "SELECT c.name, c.city, COUNT(*) AS orders, ROUND(SUM(o.total), 2) AS spent\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.status <> 'cancelled'\nGROUP BY c.id\nORDER BY spent DESC\nLIMIT {{how_many:number=10}};"),
    q('refund-audit', 'starter-sales', 'Refund audit', ['audit'], false,
      "SELECT o.id, c.name AS customer, o.total, o.placed_at\nFROM orders o\nJOIN customers c ON c.id = o.customer_id\nWHERE o.status = 'refunded'\nORDER BY o.total DESC;"),
    q('row-counts', 'starter-checks', 'Row counts, all tables', ['audit'], true,
      "SELECT 'customers' AS table_name, COUNT(*) AS row_count FROM customers\nUNION ALL SELECT 'orders', COUNT(*) FROM orders\nUNION ALL SELECT 'order_items', COUNT(*) FROM order_items\nUNION ALL SELECT 'products', COUNT(*) FROM products;"),
    q('no-city', 'starter-checks', 'Customers with no city', ['cleanup'], false,
      'SELECT id, name, email, joined_on\nFROM customers\nWHERE city IS NULL\nORDER BY joined_on;'),
    q('unshipped', 'starter-checks', 'Delivered but never shipped', ['audit'], false,
      "SELECT id, customer_id, total, placed_at\nFROM orders\nWHERE status = 'delivered' AND shipped_at IS NULL;"),
  ]
  return { folders, queries }
}
