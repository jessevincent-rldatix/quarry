import type { Dialect } from './types.ts'

/**
 * What differs between the databases when Quarry writes SQL for them: how names and text are
 * quoted, which words cannot be used bare, how a row limit, a date or a boolean is spelled.
 * The builder, the variables and the built-in templates all take these from here.
 */

const words = (text: string) => new Set(text.split(/\s+/).filter(Boolean))

// Each list is the database's own. Postgres and MySQL were read from the servers
// (pg_get_keywords() categories R and T on 16; information_schema.KEYWORDS, RESERVED = 1, on 8.4).
const RESERVED: Record<Dialect, Set<string>> = {
  mssql: words(`add all alter and any as asc authorization backup begin between break browse bulk by cascade case check checkpoint close
    clustered coalesce collate column commit compute constraint contains containstable continue convert create cross current current_date
    current_time current_timestamp current_user cursor database dbcc deallocate declare default delete deny desc disk distinct distributed
    double drop dump else end errlvl escape except exec execute exists exit external fetch file fillfactor for foreign freetext freetexttable
    from full function goto grant group having holdlock identity identity_insert identitycol if in index inner insert intersect into is join
    key kill left like lineno load merge national nocheck nonclustered not null nullif of off offsets on open opendatasource openquery
    openrowset openxml option or order outer over percent pivot plan precision primary print proc procedure public raiserror read readtext
    reconfigure references replication restore restrict return revert revoke right rollback rowcount rowguidcol rule save schema
    securityaudit select semantickeyphrasetable semanticsimilaritydetailstable semanticsimilaritytable session_user set setuser shutdown
    some statistics system_user table tablesample textsize then to top tran transaction trigger truncate try_convert tsequal union unique
    unpivot update updatetext use user values varying view waitfor when where while with within writetext`),
  postgres: words(`all analyse analyze and any array as asc asymmetric authorization binary both case cast check collate collation column
    concurrently constraint create cross current_catalog current_date current_role current_schema current_time current_timestamp
    current_user default deferrable desc distinct do else end except false fetch for foreign freeze from full grant group having ilike in
    initially inner intersect into is isnull join lateral leading left like limit localtime localtimestamp natural not notnull null offset
    on only or order outer overlaps placing primary references returning right select session_user similar some symmetric system_user
    table tablesample then to trailing true union unique user using variadic verbose when where window with`),
  mysql: words(`accessible add all alter analyze and as asc asensitive before between bigint binary blob both by call cascade case change
    char character check collate column condition constraint continue convert create cross cube cume_dist current_date current_time
    current_timestamp current_user cursor database databases day_hour day_microsecond day_minute day_second dec decimal declare default
    delayed delete dense_rank desc describe deterministic distinct distinctrow div double drop dual each else elseif empty enclosed escaped
    except exists exit explain false fetch first_value float float4 float8 for force foreign from fulltext function generated get grant
    group grouping groups having high_priority hour_microsecond hour_minute hour_second if ignore in index infile inner inout insensitive
    insert int int1 int2 int3 int4 int8 integer intersect interval into io_after_gtids io_before_gtids is iterate join json_table key keys
    kill lag last_value lateral lead leading leave left like limit linear lines load localtime localtimestamp lock long longblob longtext
    loop low_priority match maxvalue mediumblob mediumint mediumtext middleint minute_microsecond minute_second mod modifies natural
    no_write_to_binlog not nth_value ntile null numeric of on optimize optimizer_costs option optionally or order out outer outfile over
    partition percent_rank precision primary procedure purge qualify range rank read read_write reads real recursive references regexp
    release rename repeat replace require resignal restrict return revoke right rlike row row_number rows schema schemas
    second_microsecond select sensitive separator set show signal smallint spatial specific sql sql_big_result sql_calc_found_rows
    sql_small_result sqlexception sqlstate sqlwarning ssl starting stored straight_join system table tablesample terminated then tinyblob
    tinyint tinytext to trailing trigger true undo union unique unlock unsigned update usage use using utc_date utc_time utc_timestamp
    values varbinary varchar varcharacter varying virtual when where while window with write xor year_month zerofill`),
  // Snowflake's documented reserved words.
  snowflake: words(`account all alter and any as between by case cast check column connect connection constraint create cross current
    current_date current_time current_timestamp current_user database delete distinct drop else exists false following for from full
    grant group gscluster having ilike in increment inner insert intersect into is issue join lateral left like localtime localtimestamp
    minus natural not null of on or order organization qualify regexp revoke right rlike row rows sample schema select set some start
    table tablesample then to trigger true try_cast union unique update using values view when whenever where with`),
  // Databricks reserves few words outright; the everyday keywords are added so a column called "order" is always quoted.
  databricks: words(`all and anti any as between by case cast check column constraint create cross current_date current_timestamp
    current_user default delete distinct drop else end except exists false fetch for foreign from full grant group having in inner
    insert intersect into is join lateral left like limit minus natural not null of on only or order outer primary qualify references
    right select semi set some table then to true union unique update user using values when where window with`),
  // SQLite accepts many of its keywords as names depending on where they stand; quoting all of them is always right.
  sqlite: words(`abort action add after all alter always analyze and as asc attach autoincrement before begin between by cascade case cast
    check collate column commit conflict constraint create cross current current_date current_time current_timestamp database default
    deferrable deferred delete desc detach distinct do drop each else end escape except exclude exclusive exists explain fail filter first
    following for foreign from full generated glob group groups having if ignore immediate in index indexed initially inner insert instead
    intersect into is isnull join key last left like limit match materialized natural no not nothing notnull null nulls of offset on or
    order others outer over partition plan pragma preceding primary query raise range recursive references regexp reindex release rename
    replace restrict returning right rollback row rows savepoint select set table temp temporary then ties to transaction trigger
    unbounded union unique update using vacuum values view virtual when where window with without`),
}

export const isReserved = (word: string, dialect: Dialect) => RESERVED[dialect].has(word.toLowerCase())

/** Schemas whose tables are written without the schema name, so everyday names stay short. */
export const DEFAULT_SCHEMAS = ['dbo', 'public', 'main']

/** Databases where a backslash inside a '...' string escapes the next character. */
export const backslashEscapes = (dialect: Dialect) => dialect === 'mysql' || dialect === 'snowflake' || dialect === 'databricks'

/** The type to cast a value to so it can be compared as text. */
export function textType(dialect: Dialect): string {
  if (dialect === 'mssql') return 'nvarchar(max)'
  if (dialect === 'mysql') return 'char'
  if (dialect === 'snowflake') return 'varchar'
  if (dialect === 'databricks') return 'string'
  return 'text'
}

/** Wraps one name part in the database's quotes, whatever it contains. */
export function quoteName(part: string, dialect: Dialect): string {
  if (dialect === 'mssql') return `[${part.replace(/]/g, ']]')}]`
  if (dialect === 'mysql' || dialect === 'databricks') return `\`${part.replace(/`/g, '``')}\``
  return `"${part.replace(/"/g, '""')}"`
}

/** Quotes one name part only when the database would otherwise misread it; plain names stay bare so SQL stays readable. */
export function identPart(part: string, dialect: Dialect): string {
  // Postgres folds bare names to lower case and Snowflake to upper case, so a name in the other case must be quoted there.
  const plain = dialect === 'postgres' ? /^[a-z_][a-z0-9_]*$/ : dialect === 'snowflake' ? /^[A-Z_][A-Z0-9_]*$/ : /^[A-Za-z_][A-Za-z0-9_]*$/
  return plain.test(part) && !isReserved(part, dialect) ? part : quoteName(part, dialect)
}

/** The inside of a '...' literal: quotes doubled, and backslashes too where the database reads them as escapes. */
export function escapeText(value: string, dialect: Dialect): string {
  // Databricks does not read '' as a quote (it joins two strings), so the quote is escaped with a backslash there.
  if (dialect === 'databricks') return value.replace(/\\/g, '\\\\').replace(/'/g, "\\'")
  const escaped = value.replace(/'/g, "''")
  return backslashEscapes(dialect) ? escaped.replace(/\\/g, '\\\\') : escaped
}

export const quoteText = (value: string, dialect: Dialect) => `${dialect === 'mssql' ? 'N' : ''}'${escapeText(value, dialect)}'`

const HAS_BOOLEANS: Dialect[] = ['postgres', 'snowflake', 'databricks']

export const boolLiteral = (value: boolean, dialect: Dialect) => (HAS_BOOLEANS.includes(dialect) ? (value ? 'TRUE' : 'FALSE') : value ? '1' : '0')

/** The comparison for "contains": where plain LIKE is case-sensitive, the database's ILIKE is used. */
export const likeOperator = (dialect: Dialect) => (HAS_BOOLEANS.includes(dialect) ? 'ILIKE' : 'LIKE')

/** Where a row limit goes: after SELECT on SQL Server, at the end everywhere else. */
export function rowLimit(limit: string | number, dialect: Dialect): { top: string; tail: string } {
  return dialect === 'mssql' ? { top: `TOP (${limit}) `, tail: '' } : { top: '', tail: `LIMIT ${limit}` }
}

const DATE = /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?)?$/

export interface DateParts { year: string; month: string; day: string; time?: string }

/** Splits "2026-01-31" or "2026-01-31 14:05:00" into parts, or null when it is not a real date. */
export function parseDate(value: string): DateParts | null {
  const m = DATE.exec(value.trim())
  if (!m) return null
  const [, year, month, day, hour, minute, second = '00', fraction = ''] = m
  const real = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)))
  if (real.getUTCMonth() !== Number(month) - 1 || real.getUTCDate() !== Number(day)) return null
  if (hour !== undefined && (Number(hour) > 23 || Number(minute) > 59 || Number(second) > 59)) return null
  return { year, month, day, time: hour === undefined ? undefined : `${hour}:${minute}:${second}${fraction}` }
}

/** A quoted date the database reads the same way whatever its language settings. */
export function dateLiteral(value: string, dialect: Dialect): string | null {
  const d = parseDate(value)
  if (!d) return null
  // SQL Server reads '2026-03-04' as 4 March or 3 April depending on the login's language; these forms never vary.
  if (dialect === 'mssql') return d.time === undefined ? `'${d.year}${d.month}${d.day}'` : `'${d.year}-${d.month}-${d.day}T${d.time}'`
  return `'${value.trim()}'`
}

/** The day after a date, as YYYY-MM-DD. */
export function nextDay(d: DateParts): string {
  return new Date(Date.UTC(Number(d.year), Number(d.month) - 1, Number(d.day) + 1)).toISOString().slice(0, 10)
}

export type ValueKind = 'bool' | 'number' | 'date' | 'datetime' | 'text' | 'other'

/** What a schema column holds, from the database's name for its type. Unknown or blank types are 'other'. */
export function valueKind(type: string): ValueKind {
  const t = type.trim().toLowerCase()
  // An array of text is not text.
  if (t.endsWith('[]') || t.startsWith('_')) return 'other'
  // Nor is an array, map or struct of text, as Databricks writes them: array<string>.
  if (/^(array|map|struct|variant|object)\b/.test(t)) return 'other'
  if (/^(bool|boolean|bit|bit\(1\)|tinyint\(1\))$/.test(t)) return 'bool'
  if (/^((tiny|small|medium|big)?int(eger)?\d*|decimal|numeric|dec|real|float\d*|double|money|smallmoney|number|long|short|byte|(small|big)?serial)\b/.test(t)) return 'number'
  if (/^(datetime2?|smalldatetime|datetimeoffset|timestamp( |\(|_|tz|$))/.test(t)) return 'datetime'
  if (t === 'date') return 'date'
  if (/char|text|string|clob/.test(t)) return 'text'
  return 'other'
}
