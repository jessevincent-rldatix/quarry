import { describe, expect, it } from 'vitest'
import type { Dialect } from '@shared/types'
import { formatSql } from './formatSql'

const DIALECTS: Dialect[] = ['sqlite', 'mssql', 'postgres', 'mysql']

/** Words, numbers and single symbols, ignoring layout. Deliberately not the scanner formatSql itself uses. */
const tokens = (sql: string) => sql.match(/[A-Za-z0-9_@#$]+|[^\sA-Za-z0-9_@#$]/g) ?? []
const lower = (list: string[]) => list.map((t) => t.toLowerCase())
/** The formatted text on one line, so a test can look for a phrase without caring where lines break. */
const flat = (sql: string, dialect: Dialect) => formatSql(sql, dialect).replace(/\s+/g, ' ')

describe.each(DIALECTS)('formatSql on %s', (dialect) => {
  it('upper-cases keywords and built-in function names', () => {
    const out = flat('select count(*) as trips, max(distance) from trips where id > 1 group by vehicle order by 1 desc', dialect)
    expect(out).toContain('SELECT COUNT(*) AS trips, MAX(distance) FROM trips WHERE id > 1 GROUP BY vehicle ORDER BY 1 DESC')
  })

  it.each(['first', 'action', 'rows', 'key', 'user', 'type', 'year', 'row', 'Total', 'index', 'view', 'end', 'desc', 'offset', 'values'])(
    'leaves the alias "%s" exactly as typed after AS', (alias) => {
      expect(flat(`select 1 as ${alias}`, dialect)).toBe(`SELECT 1 AS ${alias}`)
      // Compared as tokens: the formatter treats some of these as clauses and breaks the line around them.
      expect(tokens(flat(`select a as ${alias}, b from t`, dialect))).toEqual(tokens(`SELECT a AS ${alias}, b FROM t`))
    })

  it('leaves names in a select list as typed, bare or qualified', () => {
    const typed = ['first', 'action', 'rows', 'key', 'user', 'type', 'year', 'row', 'by', 'set', 'desc', 'offset', 'index', 't.end', 't.Values']
    const out = flat(`select ${typed.join(', ')} from t`, dialect)
    // Compared as tokens: the formatter may put a space after a keyword-like name, never change its letters.
    expect(tokens(out)).toEqual(tokens(`SELECT ${typed.join(', ')} FROM t`))
  })

  it('leaves names as typed in the other places a name can stand', () => {
    expect(tokens(flat('select a from t where action = 1 and rows > 2 order by first, year desc', dialect)))
      .toEqual(tokens('SELECT a FROM t WHERE action = 1 AND rows > 2 ORDER BY first, year DESC'))
    expect(tokens(flat('insert into action (id, key) values (1, 2)', dialect))).toEqual(tokens('INSERT INTO action (id, key) VALUES (1, 2)'))
    expect(tokens(flat('select count(*) rows from t', dialect))).toEqual(tokens('SELECT COUNT(*) rows FROM t'))
  })

  it('never changes a token other than its case, and never the case of a name it was given in upper or mixed case', () => {
    const sql = `select T.Id, "Mixed Name", 'it''s a string with select in it', {{from_date:date}} as Since -- select nothing\nfrom Trips T left join Vehicles V on V.Id = T.VehicleId where T.Km between 1 and 20 and V.Plate like 'AB%' /* block */ order by 1`
    const out = formatSql(sql, dialect)
    expect(lower(tokens(out))).toEqual(lower(tokens(sql)))
    for (const kept of ['T.Id', '"Mixed Name"', "'it''s a string with select in it'", '{{from_date:date}}', 'Since', '-- select nothing', 'Trips T', 'Vehicles V', 'V.Id = T.VehicleId', 'T.Km', '/* block */']) {
      expect(out).toContain(kept)
    }
  })

  it('is stable: formatting the result again changes nothing', () => {
    const once = formatSql('select count(*) as first, year from t where action = 1 group by year order by 1 desc', dialect)
    expect(formatSql(once, dialect)).toBe(once)
  })
})

describe('formatSql keyword phrases', () => {
  it('still upper-cases words that are keywords only in a phrase', () => {
    expect(flat('select a from t order by a desc nulls first', 'postgres')).toContain('ORDER BY a DESC NULLS FIRST')
    expect(flat('select sum(b) over (partition by c order by d rows between unbounded preceding and current row) from t', 'sqlite'))
      .toContain('OVER ( PARTITION BY c ORDER BY d ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW )')
    expect(flat('create table t (id int primary key, action int)', 'sqlite')).toContain('PRIMARY KEY, action')
  })

  it('treats the word after AS as a keyword when it starts a query', () => {
    expect(flat('create view v as select 1 as first', 'postgres')).toContain('AS SELECT 1 AS first')
    expect(flat('with c as (select 1) select * from c', 'sqlite')).toContain('c AS ( SELECT 1 ) SELECT * FROM c')
  })
})

describe('formatSql on T-SQL scripts', () => {
  const script = [
    'with recent as (select top 5 * from dbo.[Trip Log] where vehicle_id = @id)',
    'select getdate() as first, r.* from recent r',
    'GO',
    'if exists (select 1 from dbo.vehicles where retired = 1)',
    'begin',
    "  print 'retired vehicles found'; update dbo.vehicles set checked = 1 where retired = 1",
    'end',
    'go',
    'select {{n:number=3}} as rows',
  ].join('\n')

  it('keeps the same tokens in the same order', () => {
    const out = formatSql(script, 'mssql')
    expect(lower(tokens(out))).toEqual(lower(tokens(script)))
    expect(out).toContain('dbo.[Trip Log]')
    expect(out).toContain('{{n:number=3}} AS rows')
    expect(out).toContain('GETDATE() AS first')
  })

  it('keeps every GO on a line of its own, since it only separates batches there', () => {
    const lines = formatSql(script, 'mssql').split('\n')
    expect(lines.filter((line) => /^go$/i.test(line))).toEqual(['GO', 'go'])
    expect(lines.some((line) => /\bgo\b/i.test(line) && !/^go$/i.test(line))).toBe(false)
  })

  it('does not treat GO inside a string as a separator', () => {
    const out = formatSql("select 'a\nGO\nb' as note\nGO\nselect 2", 'mssql')
    expect(out).toContain("'a\nGO\nb'")
    expect(out.split('\n').filter((line) => line === 'GO')).toHaveLength(2)
  })
})
