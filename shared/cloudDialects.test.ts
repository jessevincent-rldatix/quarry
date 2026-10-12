import { describe, expect, it } from 'vitest'
import { boolLiteral, escapeText, identPart, likeOperator, quoteName, quoteText, rowLimit, textType, valueKind } from './dialect'
import { readOnlyViolation, riskyWrite } from './readonly'
import { scan, splitStatements, statementAt } from './sqlScan'

const kinds = (sql: string, dialect: 'snowflake' | 'databricks') => scan(sql, dialect).tokens.map((t) => `${t.kind}:${t.text}`)

describe('Snowflake and Databricks: writing SQL', () => {
  it('quotes names the way each database reads them', () => {
    expect(quoteName('my "odd" name', 'snowflake')).toBe('"my ""odd"" name"')
    expect(quoteName('my `odd` name', 'databricks')).toBe('`my ``odd`` name`')
  })

  it('leaves a Snowflake name bare only when it is stored in capitals', () => {
    expect(identPart('ORDERS', 'snowflake')).toBe('ORDERS')
    expect(identPart('ORDER_ITEMS_2', 'snowflake')).toBe('ORDER_ITEMS_2')
    // Bare, this would be read as ORDERS, which is another table.
    expect(identPart('orders', 'snowflake')).toBe('"orders"')
    expect(identPart('Orders', 'snowflake')).toBe('"Orders"')
    expect(identPart('ORDER', 'snowflake')).toBe('"ORDER"')
    expect(identPart('TOTAL $', 'snowflake')).toBe('"TOTAL $"')
  })

  it('leaves a Databricks name bare whatever its case, and quotes keywords and odd names', () => {
    expect(identPart('orders', 'databricks')).toBe('orders')
    expect(identPart('OrderItems', 'databricks')).toBe('OrderItems')
    expect(identPart('order', 'databricks')).toBe('`order`')
    expect(identPart('unit-price', 'databricks')).toBe('`unit-price`')
  })

  it('escapes text so it cannot end the string early', () => {
    expect(quoteText("it's", 'snowflake')).toBe("'it''s'")
    expect(quoteText('a\\b', 'snowflake')).toBe("'a\\\\b'")
    // Databricks reads '' as the end of one string and the start of another.
    expect(quoteText("it's", 'databricks')).toBe("'it\\'s'")
    expect(quoteText('a\\b', 'databricks')).toBe("'a\\\\b'")
    // A backslash before a quote is the classic way out of a string.
    expect(escapeText("\\' OR 1=1 --", 'databricks')).toBe("\\\\\\' OR 1=1 --")
    expect(escapeText("\\' OR 1=1 --", 'snowflake')).toBe("\\\\'' OR 1=1 --")
  })

  it('what an escaped value becomes is one string to the scanner', () => {
    for (const dialect of ['snowflake', 'databricks'] as const) {
      for (const value of ["it's", "\\' OR 1=1 --", "a\\", "'; DROP TABLE t; --", '"', '$$']) {
        const { tokens, unterminated } = scan(`SELECT ${quoteText(value, dialect)} AS v`, dialect)
        expect(unterminated, `${dialect} ${value}`).toBeNull()
        expect(tokens.map((t) => t.kind), `${dialect} ${value}`).toEqual(['word', 'string', 'word', 'word'])
      }
    }
  })

  it('uses real booleans, ILIKE and LIMIT', () => {
    for (const dialect of ['snowflake', 'databricks'] as const) {
      expect(boolLiteral(true, dialect)).toBe('TRUE')
      expect(likeOperator(dialect)).toBe('ILIKE')
      expect(rowLimit(10, dialect)).toEqual({ top: '', tail: 'LIMIT 10' })
    }
    expect(textType('snowflake')).toBe('varchar')
    expect(textType('databricks')).toBe('string')
  })

  it('knows what their column types hold', () => {
    expect(['NUMBER(38,0)', 'FLOAT', 'bigint', 'decimal(10,2)', 'double', 'long', 'int'].map(valueKind)).toEqual(Array(7).fill('number'))
    expect(['TIMESTAMP_NTZ(9)', 'TIMESTAMP_LTZ', 'timestamp_ntz', 'timestamp'].map(valueKind)).toEqual(Array(4).fill('datetime'))
    expect(['VARCHAR(100)', 'TEXT', 'string'].map(valueKind)).toEqual(Array(3).fill('text'))
    expect(['BOOLEAN', 'boolean'].map(valueKind)).toEqual(['bool', 'bool'])
    expect(['VARIANT', 'array<string>', 'struct<a:int>'].map(valueKind)).toEqual(Array(3).fill('other'))
  })
})

describe('Snowflake and Databricks: reading SQL', () => {
  it('Snowflake: // comments, $$ strings, backslash escapes, quoted names', () => {
    expect(kinds("SELECT 1 // DROP TABLE t\n, 'a\\'b; DROP' , \"My Col\"", 'snowflake')).toEqual(['word:select', 'punct:,', "string:'a\\'b; DROP'", 'punct:,', 'quoted:"My Col"'])
    expect(kinds('SELECT $$ it\'s; DROP TABLE t $$ AS x', 'snowflake')).toEqual(['word:select', "string:$$ it's; DROP TABLE t $$", 'word:as', 'word:x'])
    // $1 is a column of a staged file, not the start of a string.
    expect(scan('SELECT $1, $2 FROM t', 'snowflake').unterminated).toBeNull()
    expect(scan('SELECT $$ never closed', 'snowflake').unterminated).toBe('dollar-quoted string')
  })

  it('Databricks: both quotes hold text, backticks hold names, comments nest, r-strings keep backslashes', () => {
    expect(kinds('SELECT "a; DROP", \'b\\\'c\', `my col`', 'databricks')).toEqual(['word:select', 'string:"a; DROP"', 'punct:,', "string:'b\\'c'", 'punct:,', 'quoted:`my col`'])
    expect(kinds('SELECT 1 /* a /* nested */ DROP TABLE t */ + 2', 'databricks')).toEqual(['word:select', 'punct:+'])
    expect(kinds("SELECT r'C:\\dir\\' AS p, raster", 'databricks')).toEqual(['word:select', "string:r'C:\\dir\\'", 'word:as', 'word:p', 'punct:,', 'word:raster'])
  })

  it('splits a script into statements with the line each starts on', () => {
    expect(splitStatements("SELECT ';';\n\n-- only a comment;\n\nSELECT 2\n;\n  ", 'snowflake')).toEqual([{ sql: "SELECT ';'", line: 1 }, { sql: '-- only a comment;\n\nSELECT 2', line: 3 }])
    expect(splitStatements('  \n-- nothing here\n', 'databricks')).toEqual([])
    expect(splitStatements('SELECT CASE WHEN a THEN 1 END; SELECT 2', 'databricks').map((s) => s.sql)).toEqual(['SELECT CASE WHEN a THEN 1 END', 'SELECT 2'])
  })

  it('finds the statement under the cursor', () => {
    const sql = 'SELECT 1;\nSELECT `a;b` FROM t;\nSELECT 3;'
    expect(statementAt(sql, sql.indexOf('FROM'), 'databricks')).toEqual({ text: 'SELECT `a;b` FROM t;', line: 2 })
  })
})

describe('Snowflake and Databricks: the read-only guard', () => {
  const allowed: [string, 'snowflake' | 'databricks'][] = [
    ['SELECT * FROM ORDERS LIMIT 10', 'snowflake'],
    ['WITH t AS (SELECT 1) SELECT * FROM t', 'snowflake'],
    ['SHOW TABLES IN SCHEMA PUBLIC', 'snowflake'],
    ['DESCRIBE TABLE ORDERS', 'snowflake'],
    ['USE WAREHOUSE COMPUTE_WH; USE SCHEMA SALES; SELECT 1', 'snowflake'],
    ['SELECT * FROM TABLE(information_schema.query_history())', 'snowflake'],
    ["SELECT SYSTEM$CLUSTERING_INFORMATION('ORDERS')", 'snowflake'],
    ["SELECT 'DROP TABLE x' // DELETE FROM y", 'snowflake'],
    ['SELECT $$ DELETE FROM t $$', 'snowflake'],
    ['EXPLAIN SELECT 1', 'snowflake'],
    ['SELECT * FROM main.sales.orders LIMIT 10', 'databricks'],
    ['SHOW CATALOGS', 'databricks'],
    ['DESCRIBE DETAIL main.sales.orders', 'databricks'],
    ['USE CATALOG main; SELECT 1', 'databricks'],
    ['SELECT "DROP TABLE x", `delete` FROM t', 'databricks'],
    ['SELECT 1 /* /* DROP */ DELETE */', 'databricks'],
  ]
  it.each(allowed)('allows %s', (sql, dialect) => expect(readOnlyViolation(sql, dialect)).toBeNull())

  const refused: [string, 'snowflake' | 'databricks'][] = [
    ['INSERT INTO t VALUES (1)', 'snowflake'],
    ['CREATE OR REPLACE TABLE t AS SELECT 1', 'snowflake'],
    ['CALL my_procedure()', 'snowflake'],
    ["COPY INTO t FROM @stage", 'snowflake'],
    ['PUT file://x @stage', 'snowflake'],
    ['SELECT my_seq.NEXTVAL', 'snowflake'],
    ["SELECT SYSTEM$CANCEL_ALL_QUERIES(123)", 'snowflake'],
    ['ALTER WAREHOUSE wh SUSPEND', 'snowflake'],
    ['SELECT 1; DROP TABLE t', 'snowflake'],
    ['UNDROP TABLE t', 'snowflake'],
    ['SELECT 1 // harmless\n; DELETE FROM t', 'snowflake'],
    ["SELECT 'a\\'; DELETE FROM t --'; DELETE FROM t", 'snowflake'],
    ['MERGE INTO t USING s ON t.id = s.id WHEN MATCHED THEN DELETE', 'databricks'],
    ['OPTIMIZE main.sales.orders', 'databricks'],
    ['VACUUM main.sales.orders', 'databricks'],
    ['SELECT 1; TRUNCATE TABLE t', 'databricks'],
    ["SELECT \"a\\\"; DROP TABLE t --\"; DROP TABLE t", 'databricks'],
    ['SET spark.sql.ansi.enabled = false', 'databricks'],
    ["SELECT 'unfinished", 'databricks'],
  ]
  it.each(refused)('refuses %s', (sql, dialect) => expect(readOnlyViolation(sql, dialect)).not.toBeNull())

  it('still asks before a risky write on a writable connection', () => {
    expect(riskyWrite('DELETE FROM ORDERS', 'snowflake')).toMatch(/no WHERE/)
    expect(riskyWrite('TRUNCATE TABLE main.sales.orders', 'databricks')).toMatch(/TRUNCATE/)
    expect(riskyWrite("UPDATE t SET a = 'x; WHERE' WHERE id = 1", 'databricks')).toBeNull()
  })
})
