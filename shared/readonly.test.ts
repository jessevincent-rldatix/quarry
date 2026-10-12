import { describe, expect, it } from 'vitest'
import { readOnlyViolation, riskyWrite } from './readonly'
import { scan, splitBatches, statementAt } from './sqlScan'
import type { Dialect } from './types'

describe('read-only guard: reads that must be allowed', () => {
  const allowed: [Dialect, string][] = [
    ['mysql', 'SHOW CREATE TABLE plants'],
    ['mysql', 'SHOW TABLES; SHOW CREATE TABLE plants;'],
    ['mysql', 'DESCRIBE plants'],
    ['mysql', "SELECT insert('abc', 1, 1, 'x')"],
    ['postgres', 'SHOW transaction_read_only'],
    ['postgres', "SELECT E'it\\'s ok' AS s"],
    ['postgres', "SELECT E'a\\\\' AS s, 'b' AS t"],
    ['postgres', 'SELECT x.update, x.delete FROM t x'],
    ['postgres', "SELECT $$it's; drop table t$$"],
    ['mssql', 'SELECT TOP 1 1 FROM a INNER MERGE JOIN b ON a.id = b.id OPTION (MERGE JOIN, HASH GROUP)'],
    ['mssql', 'SELECT 1 OPTION (MERGE UNION)'],
    ['mssql', 'SELECT 1 AS [Create Date]'],
    ['mssql', 'EXEC sys.sp_help'],
    ['mssql', "EXEC sp_columns 'trips'"],
    ['mssql', "RAISERROR('note', 10, 1)"],
    ['sqlite', 'PRAGMA table_info(orders)'],
  ]
  it.each(allowed)('%s: %s', (dialect, sql) => expect(readOnlyViolation(sql, dialect)).toBeNull())
})

describe('read-only guard: writes that must be refused', () => {
  const refused: [Dialect, string][] = [
    ['mssql', 'SELECT NEXT VALUE FOR dbo.seq'],
    ['mssql', 'SELECT next\nvalue /* x */ for dbo.seq'],
    ['mssql', "RAISERROR('x', 10, 1) WITH LOG"],
    // No semicolons in T-SQL: a number ending in a dot must not make the next word look like a column.
    ['mssql', 'SELECT 1. DELETE FROM t'],
    ['mssql', 'SELECT 1 FROM t x.DELETE FROM t'],
    ['mssql', 'EXEC master..xp_cmdshell'],
    ['mssql', 'MERGE INTO t USING s ON 1 = 1 WHEN MATCHED THEN DELETE;'],
    ['postgres', "SELECT nextval('s')"],
    ['postgres', "SELECT setval('s', 1)"],
    ['postgres', 'SHOW x; DROP TABLE t'],
    ['postgres', 'EXPLAIN ANALYZE DELETE FROM t'],
    ['postgres', "SELECT E'a\\'; DROP TABLE t; --'; DROP TABLE t"],
    ['mysql', 'SHOW TABLES; DROP TABLE t'],
    ['mysql', 'INSERT t (a) VALUES (1)'],
    ['mysql', 'WITH x AS (SELECT 1) INSERT INTO t SELECT * FROM x'],
    ['mysql', 'SELECT 1 INTO OUTFILE "/tmp/x"'],
    ['sqlite', 'PRAGMA journal_mode = WAL'],
  ]
  it.each(refused)('%s: %s', (dialect, sql) => expect(readOnlyViolation(sql, dialect)).not.toBeNull())
})

describe('risky writes', () => {
  const risky: [Dialect, string][] = [
    ['mssql', 'DELETE FROM t\nSELECT * FROM x WHERE y = 1'],
    ['mssql', 'UPDATE t SET a = 1\nSELECT * FROM x WHERE y = 1'],
    ['mssql', 'UPDATE t SET a = 1\nEXEC sp_who'],
    ['postgres', 'UPDATE t SET a = 1; SELECT 1 WHERE true'],
    ['postgres', 'INSERT INTO t VALUES (1) ON CONFLICT (id) DO NOTHING; DELETE FROM t'],
    ['mysql', 'TRUNCATE TABLE t'],
    ['sqlite', 'DROP TABLE t'],
  ]
  it.each(risky)('asks first, %s: %s', (dialect, sql) => expect(riskyWrite(sql, dialect)).not.toBeNull())

  const fine: [Dialect, string][] = [
    ['postgres', 'INSERT INTO t (id, a) VALUES (1, 2) ON CONFLICT (id) DO UPDATE SET a = excluded.a'],
    ['mysql', 'INSERT INTO t (id, a) VALUES (1, 2) ON DUPLICATE KEY UPDATE a = 2'],
    ['mssql', 'UPDATE t WITH (ROWLOCK) SET a = CASE WHEN b = 1 THEN 2 ELSE 3 END WHERE id = 1'],
    ['mysql', 'UPDATE t USE INDEX (i) SET a = IF(b, 1, 2) WHERE id = 1'],
    ['mssql', 'MERGE t USING s ON t.id = s.id WHEN MATCHED THEN UPDATE SET a = s.a;'],
    ['postgres', 'CREATE TRIGGER x AFTER UPDATE OR DELETE ON t FOR EACH ROW EXECUTE FUNCTION f()'],
    ['postgres', 'SELECT * FROM t FOR UPDATE'],
    ['mssql', 'DELETE TOP (10) FROM t'],
  ]
  it.each(fine)('does not ask, %s: %s', (dialect, sql) => expect(riskyWrite(sql, dialect)).toBeNull())
})

describe('scanner', () => {
  it('reads each database’s quotes and comments', () => {
    const words = (sql: string, dialect: Dialect) => scan(sql, dialect).tokens.filter((t) => t.kind === 'word').map((t) => t.text)
    expect(words("SELECT [it's], 1 -- drop", 'mssql')).toEqual(['select'])
    expect(words('SELECT 1 # drop\n, `a``b`', 'mysql')).toEqual(['select'])
    expect(words("SELECT 'a\\'b' , c", 'mysql')).toEqual(['select', 'c'])
    expect(words("SELECT 'a\\', c", 'postgres')).toEqual(['select', 'c'])
    expect(words('SELECT /* a /* b */ c */ d', 'postgres')).toEqual(['select', 'd'])
  })

  it('keeps a {{variable}} whole when asked, even with a quote in its default', () => {
    const tokens = scan("WHERE a = {{name=O'Brien}} AND b = 'x {{q}}'", 'postgres', { variables: true }).tokens
    expect(tokens.filter((t) => t.kind === 'var').map((t) => t.text)).toEqual(["{{name=O'Brien}}"])
    expect(tokens.filter((t) => t.kind === 'string').map((t) => t.text)).toEqual(["'x {{q}}'"])
  })

  it('still gives a token for a string that is not finished yet', () => {
    const { tokens, unterminated } = scan("SELECT 'abc {{x}}", 'sqlite', { variables: true })
    expect(unterminated).toBe('string')
    expect(tokens.at(-1)).toMatchObject({ kind: 'string', text: "'abc {{x}}" })
  })
})

describe('GO batches', () => {
  it('splits on GO lines only, with offsets and line numbers, on either line ending', () => {
    for (const newline of ['\n', '\r\n']) {
      const sql = ['SELECT 1', 'GO', "SELECT 'GO'", 'go 3', '', 'SELECT 3'].join(newline)
      const batches = splitBatches(sql)
      expect(batches.map((b) => b.sql.trim())).toEqual(['SELECT 1', "SELECT 'GO'", 'SELECT 3'])
      expect(batches.map((b) => b.line)).toEqual([1, 3, 5])
      for (const b of batches) expect(sql.slice(b.start, b.end)).toBe(b.sql)
    }
  })
})

describe('statement at cursor', () => {
  const at = (sql: string, marker: string, dialect: Dialect) => statementAt(sql, sql.indexOf(marker), dialect)

  it('uses semicolons, ignoring ones in strings', () => {
    const sql = "SELECT 1;\nSELECT ';' AS semi;\nSELECT 3"
    expect(at(sql, 'semi', 'postgres').text).toBe("SELECT ';' AS semi;")
    expect(statementAt(sql, sql.length, 'postgres')).toEqual({ text: 'SELECT 3', line: 3 })
  })

  it('never crosses a GO line on SQL Server', () => {
    const sql = 'IF @a = 1\nBEGIN\n  SELECT 1;\nEND\nGO\nSELECT 3\nGO\nSELECT 4'
    expect(at(sql, 'SELECT 3', 'mssql')).toEqual({ text: 'SELECT 3', line: 6 })
    expect(at(sql, 'SELECT 4', 'mssql')).toEqual({ text: 'SELECT 4', line: 8 })
  })

  it('keeps a BEGIN ... END block and a CASE in one piece', () => {
    const block = 'IF @a = 1\nBEGIN\n  SELECT 1;\n  SELECT 2;\nEND'
    expect(at(block, 'SELECT 1', 'mssql').text).toBe(block)
    const tryCatch = 'BEGIN TRY\n  SELECT 1;\nEND TRY\nBEGIN CATCH\n  SELECT 2;\nEND CATCH;\nSELECT 9;'
    expect(at(tryCatch, 'SELECT 2', 'mssql').text).toBe('BEGIN TRY\n  SELECT 1;\nEND TRY\nBEGIN CATCH\n  SELECT 2;\nEND CATCH;')
    expect(at(tryCatch, 'SELECT 9', 'mssql').text).toBe('SELECT 9;')
    const trigger = 'CREATE TRIGGER t AFTER INSERT ON x BEGIN\n  UPDATE y SET b = 2;\n  DELETE FROM z;\nEND;\nSELECT 1;'
    expect(at(trigger, 'UPDATE y', 'sqlite').text).toBe('CREATE TRIGGER t AFTER INSERT ON x BEGIN\n  UPDATE y SET b = 2;\n  DELETE FROM z;\nEND;')
    const cased = 'SELECT CASE WHEN a THEN 1 ELSE 2 END AS x;\nSELECT 2;'
    expect(at(cased, 'SELECT 2', 'postgres').text).toBe('SELECT 2;')
  })

  it('treats BEGIN as a transaction when that is what it is', () => {
    const sql = 'BEGIN;\nUPDATE t SET a = 1 WHERE id = 1;\nCOMMIT;'
    expect(at(sql, 'UPDATE', 'postgres').text).toBe('UPDATE t SET a = 1 WHERE id = 1;')
    const tsql = 'BEGIN TRANSACTION;\nUPDATE t SET a = 1 WHERE id = 1;\nCOMMIT;'
    expect(at(tsql, 'UPDATE', 'mssql').text).toBe('UPDATE t SET a = 1 WHERE id = 1;')
  })

  it('reads a Postgres E-string with an escaped quote', () => {
    const sql = "SELECT E'a\\'; b' AS x;\nSELECT 2;"
    expect(at(sql, 'SELECT 2', 'postgres').text).toBe('SELECT 2;')
  })
})
