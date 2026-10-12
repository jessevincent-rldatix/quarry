import { describe, expect, it } from 'vitest'
import type { Dialect } from '@shared/types'
import { NULL_VALUE, parseVars, quoteIdent, renderSql } from './template'

const render = (sql: string, values: Record<string, string>, dialect: Dialect) => renderSql(sql, values, dialect)

describe('variables next to quotes and comments', () => {
  // An apostrophe that is not a string quote used to flip "inside a string", and the next value went in unquoted.
  const cases: [Dialect, string, string][] = [
    ['mssql', "SELECT 1 AS [it's], {{x}} AS v", "SELECT 1 AS [it's], N'abc' AS v"],
    ['postgres', 'SELECT 1 AS "it\'s", {{x}} AS v', 'SELECT 1 AS "it\'s", \'abc\' AS v'],
    ['mysql', "SELECT 1 # it's\n, {{x}} AS v", "SELECT 1 # it's\n, 'abc' AS v"],
    ['mysql', "SELECT 'a\\'b', {{x}} AS v", "SELECT 'a\\'b', 'abc' AS v"],
    ['postgres', "SELECT $$it's$$, {{x}} AS v", "SELECT $$it's$$, 'abc' AS v"],
    ['mssql', 'SELECT [a--b], {{x}} AS v', "SELECT [a--b], N'abc' AS v"],
    ['postgres', "SELECT E'a\\'b', {{x}} AS v", "SELECT E'a\\'b', 'abc' AS v"],
  ]
  it.each(cases)('%s: %s', (dialect, sql, expected) => expect(render(sql, { x: 'abc' }, dialect)).toEqual({ sql: expected, errors: [] }))

  it('never inserts live SQL', () => {
    const { sql } = render("SELECT 1 AS [it's] WHERE a = {{x}}", { x: '1 OR 1=1' }, 'mssql')
    expect(sql).toBe("SELECT 1 AS [it's] WHERE a = N'1 OR 1=1'")
  })

  it('ignores variables in comments, per database', () => {
    expect(parseVars('SELECT 1 -- {{a}}\n/* {{b}} */ {{c}}', 'postgres').map((v) => v.name)).toEqual(['c'])
    expect(parseVars('SELECT 1 # {{a}}\n, {{c}}', 'mysql').map((v) => v.name)).toEqual(['c'])
    // # is not a comment elsewhere.
    expect(parseVars('SELECT #{{a}}', 'mssql').map((v) => v.name)).toEqual(['a'])
  })

  it('finds a variable in a string that is still being typed', () => {
    expect(parseVars("SELECT 'abc {{x}}", 'sqlite').map((v) => v.name)).toEqual(['x'])
  })
})

describe('variables inside quotes the query wrote', () => {
  it('escapes for the quote it is in', () => {
    expect(render("LIKE '%{{q}}%'", { q: "O'Brien" }, 'postgres').sql).toBe("LIKE '%O''Brien%'")
    expect(render("LIKE '%{{q}}%'", { q: 'a\\b' }, 'mysql').sql).toBe("LIKE '%a\\\\b%'")
    expect(render("LIKE E'%{{q}}%'", { q: "a\\'b" }, 'postgres').sql).toBe("LIKE E'%a\\\\''b%'")
    expect(render('SELECT * FROM [{{t}}]', { t: 'a]b' }, 'mssql').sql).toBe('SELECT * FROM [a]]b]')
    expect(render('SELECT * FROM "{{t}}"', { t: 'a"b' }, 'postgres').sql).toBe('SELECT * FROM "a""b"')
    expect(render('SELECT "{{t}}"', { t: 'a"b\\' }, 'mysql').sql).toBe('SELECT "a""b\\\\"')
  })

  it('refuses a value inside a $$ string, where nothing can be escaped', () => {
    expect(render('SELECT $$ {{x}} $$', { x: 'a' }, 'postgres').errors[0]).toMatch(/inside a \$\$ string/)
  })
})

describe('number variables', () => {
  const ok: [string, string, string][] = [
    ['{{n:number}}', '5', '5'], ['{{n:number}}', '+5', '5'], ['{{n:number}}', '.5', '0.5'], ['{{n:number}}', '-.5', '-0.5'],
    ['{{n:number}}', '5.', '5'], ['{{n:number}}', '1e3', '1e3'], ['{{n:number}}', ' 12.50 ', '12.50'],
    // A bare negative, so LIMIT and TOP accept it; brackets only where it would otherwise make a comment.
    ['LIMIT {{n:number}}', '-1', 'LIMIT -1'], ['a - {{n:number}}', '-1', 'a - -1'], ['a -{{n:number}}', '-1', 'a -(-1)'],
  ]
  it.each(ok)('%s with %s', (sql, n, expected) => expect(render(sql, { n }, 'sqlite')).toEqual({ sql: expected, errors: [] }))
  it.each(['1,000', '1 OR 1', 'abc', '--1', '1e', '.'])('refuses %s', (n) => expect(render('{{n:number}}', { n }, 'sqlite').errors).toEqual(['n must be a number']))
})

describe('list variables', () => {
  const cases: [string, Dialect, string][] = [
    ['1, 2, 3', 'postgres', '1, 2, 3'],
    ["'a','b'", 'postgres', "'a', 'b'"],
    ["'a','b'", 'mssql', "N'a', N'b'"],
    ['"Smith, John", Doe', 'postgres', "'Smith, John', 'Doe'"],
    // Quoted numbers are codes kept as text, which Postgres needs when the column is text.
    ["'1', '2'", 'postgres', "'1', '2'"],
    ["'O''Brien', x", 'postgres', "'O''Brien', 'x'"],
    ['a\nb\n', 'sqlite', "'a', 'b'"],
    ['007, 8', 'sqlite', "'007', '8'"],
    ['a,,b,', 'sqlite', "'a', 'b'"],
  ]
  it.each(cases)('%s on %s', (v, dialect, expected) => expect(render('{{v:list}}', { v }, dialect)).toEqual({ sql: expected, errors: [] }))
  it('needs at least one item', () => expect(render('{{v:list}}', { v: ' , ' }, 'sqlite').errors).toEqual(['v needs at least one value']))
})

describe('empty, NULL and conflicting variables', () => {
  it('treats an empty box as forgotten unless {{name=}} says empty is meant', () => {
    expect(render('a = {{x}}', {}, 'sqlite').errors).toEqual(['x is empty'])
    expect(render('a = {{x=}}', {}, 'sqlite')).toEqual({ sql: "a = ''", errors: [] })
    expect(render("a LIKE '{{x=}}%'", {}, 'sqlite')).toEqual({ sql: "a LIKE '%'", errors: [] })
    expect(render('a = {{n:number=}}', {}, 'sqlite').errors).toEqual(['n is empty'])
  })

  it('sends NULL when asked, where NULL makes sense', () => {
    expect(render('a = {{x}} OR b = {{n:number}} OR c = {{d:date}}', { x: NULL_VALUE, n: NULL_VALUE, d: NULL_VALUE }, 'mssql').sql).toBe('a = NULL OR b = NULL OR c = NULL')
    expect(render('FROM {{t:ident}}', { t: NULL_VALUE }, 'mssql').errors).toEqual(['t cannot be NULL here'])
    expect(render("a = '{{x}}'", { x: NULL_VALUE }, 'mssql').errors).toEqual(['x cannot be NULL here'])
  })

  it('reports one name written with two types, but not a later bare use', () => {
    expect(render('{{d:date}} {{d}}', { d: '2026-01-31' }, 'sqlite')).toEqual({ sql: "'2026-01-31' '2026-01-31'", errors: [] })
    expect(render('{{d:date}} {{d:number}}', { d: '2026-01-31' }, 'sqlite').errors[0]).toMatch(/more than one type/)
  })

  it('refuses a NUL character', () => {
    expect(render('{{x}}', { x: 'a\0b' }, 'postgres').errors[0]).toMatch(/cannot be sent/)
  })
})

describe('identifiers and dates', () => {
  it('quotes names per database, keeping the gap in database..table', () => {
    expect(quoteIdent('mydb..mytable', 'mssql')).toBe('[mydb]..[mytable]')
    expect(quoteIdent('ops.[Service.Log]', 'mssql')).toBe('[ops].[Service.Log]')
    expect(quoteIdent('a`b', 'mysql')).toBe('`a``b`')
    expect(render('{{t:ident}}', { t: 'x; DROP TABLE y' }, 'postgres').errors).toEqual(['t must be a table or column name'])
  })

  it('writes dates SQL Server reads the same in any language', () => {
    expect(render('{{d:date}}', { d: '2026-03-04' }, 'mssql').sql).toBe("'20260304'")
    expect(render('{{d:date}}', { d: '2026-03-04 10:30' }, 'mssql').sql).toBe("'2026-03-04T10:30:00'")
    expect(render('{{d:date}}', { d: '2026-02-30' }, 'mssql').errors).toEqual(['d must be a real date like 2026-01-31'])
  })
})
