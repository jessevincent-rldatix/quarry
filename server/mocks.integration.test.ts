import fs from 'node:fs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { valueKind } from '@shared/dialect'
import { readOnlyViolation } from '@shared/readonly'
import type { ConnectionConfig, SchemaTable } from '@shared/types'
import { BUILTIN_TEMPLATES, templateSql } from '@/lib/builtins'
import { localTables } from '@/lib/schema'
import { OPERATORS, buildQuery, columnRef, emptyBuilder, previewSql, suggestJoin, tableKey } from '@/lib/sqlBuilder'
import { parseVars, renderSql } from '@/lib/template'
import { openDriver } from './drivers/index.ts'
import type { Driver } from './drivers/types.ts'

/**
 * Runs the SQL Quarry writes (built-in templates, the builder, previews) against the throwaway
 * mock databases, to prove each database accepts it. Skipped unless QUARRY_MOCK_PW_FILE names a
 * file holding the mocks' password:
 *
 *   QUARRY_MOCK_PW_FILE=<path> npx vitest run server/mocks.integration.test.ts
 *
 * It only reads. The containers are described in CLAUDE.md.
 */
const passwordFile = process.env.QUARRY_MOCK_PW_FILE
const password = passwordFile ? fs.readFileSync(passwordFile, 'utf8').trim() : ''

const MOCKS: ConnectionConfig[] = [
  { id: 'it-demo', name: 'shop-demo', dialect: 'sqlite', builtin: true, readOnly: false },
  { id: 'it-mssql', name: 'fleetdesk', dialect: 'mssql', host: '127.0.0.1', port: 14333, user: 'sa', database: 'fleetdesk', encrypt: true, trustServerCertificate: true, readOnly: true },
  { id: 'it-pg', name: 'bookhaven', dialect: 'postgres', host: '127.0.0.1', port: 15432, user: 'postgres', database: 'bookhaven', encrypt: false, readOnly: true },
  { id: 'it-mysql', name: 'greenhouse', dialect: 'mysql', host: '127.0.0.1', port: 13306, user: 'root', database: 'greenhouse', encrypt: false, readOnly: true },
]

/** A value of the right shape for a column, so the test is about the SQL and not about bad input. */
const sample = (type: string) => ({ bool: 'true', number: '1', date: '2026-01-15', datetime: '2026-01-15', text: 'a', other: '' })[valueKind(type)]

describe.skipIf(!passwordFile).each(MOCKS)('$name ($dialect)', (config) => {
  let driver: Driver
  let tables: SchemaTable[]
  const dialect = config.dialect

  /** Runs read-only SQL and fails with the SQL in the message when the database rejects it. */
  const run = async (sql: string, label: string) => {
    expect(readOnlyViolation(sql, dialect), `${label}: refused by the read-only guard\n${sql}`).toBeNull()
    const result = await driver.query(sql, 50)
    expect(result.error?.message, `${label}\n${sql}`).toBeUndefined()
    return result
  }

  beforeAll(async () => {
    driver = await openDriver(config, password)
    tables = localTables(await driver.schema(), config).filter((t) => !t.name.startsWith('zz_'))
  }, 60_000)
  afterAll(() => driver?.close())

  it('lists tables with typed columns', () => {
    expect(tables.length).toBeGreaterThan(0)
    for (const t of tables) expect(t.columns.length, tableKey(t)).toBeGreaterThan(0)
  })

  it('previews every table', async () => {
    for (const t of tables) await run(previewSql(t, dialect, 5), `preview ${tableKey(t)}`)
  }, 120_000)

  it('runs every built-in template on every table', async () => {
    for (const template of BUILTIN_TEMPLATES) {
      const sql = templateSql(template, dialect, tables)
      if (!sql) continue
      const names = parseVars(sql, dialect).map((v) => v.name)
      // Templates with no table variable run once; the rest once per table.
      for (const t of names.includes('table') || names.includes('child_table') ? tables.filter((x) => x.kind === 'table') : [tables[0]]) {
        const text = t.columns.find((c) => valueKind(c.type) === 'text')
        const dated = t.columns.find((c) => ['date', 'datetime'].includes(valueKind(c.type)))
        const fk = t.foreignKeys?.[0]
        const parent = fk && tables.find((p) => p.name === fk.refTable && (p.schema === fk.refSchema || !fk.refSchema))
        const values: Record<string, string> = {
          table: tableKey(t), column: (text ?? t.columns[0]).name, value: 'a', phrase: 'a', values: 'a, b', name_contains: 'id',
          from: '2026-01-01', to: '2027-01-01', date_column: dated?.name ?? '',
          child_table: tableKey(t), child_key: fk?.column ?? '', parent_table: parent ? tableKey(parent) : '', parent_key: fk?.refColumn ?? '',
        }
        // A template that needs something this table does not have (a date column, a parent) does not apply to it.
        if (names.some((n) => values[n] === '')) continue
        // "Find rows by value" and "Rows matching a list" compare with text, which only a text column accepts everywhere.
        if (!text && (names.includes('value') || names.includes('values'))) continue
        const rendered = renderSql(sql, values, dialect)
        expect(rendered.errors, `${template.name} on ${tableKey(t)}`).toEqual([])
        await run(rendered.sql, `${template.name} on ${tableKey(t)}`)
        // "Column profile" must also work on every other column type the table has.
        if (template.id === 'builtin:profile') {
          for (const c of t.columns) {
            if (/xml|json|geograph|geometr|point|text$|image/i.test(c.type)) continue
            await run(renderSql(sql, { ...values, column: c.name }, dialect).sql, `${template.name} on ${tableKey(t)}.${c.name} (${c.type})`)
          }
        }
      }
    }
  }, 300_000)

  it('runs the builder with every operator on every column', async () => {
    for (const t of tables) {
      const key = tableKey(t)
      for (const c of t.columns) {
        const value = sample(c.type)
        for (const { id: op } of OPERATORS) {
          const needsValue = op !== 'null' && op !== 'notnull'
          if (needsValue && value === '') continue
          const { sql, problems } = buildQuery({
            ...emptyBuilder(), table: key, limit: '5', columns: [columnRef(key, c.name)], sortBy: columnRef(key, c.name),
            filters: [{ id: '1', column: columnRef(key, c.name), op, value }],
          }, tables, dialect)
          expect(problems, `${key}.${c.name} ${op}`).toEqual([])
          expect(sql, `${key}.${c.name} ${op}`).toContain('WHERE')
          await run(sql, `builder ${key}.${c.name} (${c.type}) ${op}`)
        }
        const grouped = buildQuery({ ...emptyBuilder(), table: key, groupBy: columnRef(key, c.name), limit: '5' }, tables, dialect)
        if (!/xml|json|geograph|geometr|point|text$|image/i.test(c.type)) await run(grouped.sql, `builder ${key} count by ${c.name}`)
      }
    }
  }, 600_000)

  it('joins every pair of tables a foreign key links, from either side', async () => {
    let joined = 0
    for (const a of tables) {
      for (const b of tables) {
        if (a === b) continue
        const linked = a.foreignKeys?.some((fk) => fk.refTable === b.name) || b.foreignKeys?.some((fk) => fk.refTable === a.name)
        if (!linked) continue
        const guess = suggestJoin([a], b)
        expect(guess, `${tableKey(a)} joined to ${tableKey(b)}`).not.toBeNull()
        const { sql, problems } = buildQuery({
          ...emptyBuilder(), table: tableKey(a), limit: '5', joins: [{ id: '1', table: tableKey(b), from: guess!.from, to: guess!.to }],
          columns: [columnRef(tableKey(a), a.columns[0].name), columnRef(tableKey(b), b.columns[0].name)],
        }, tables, dialect)
        expect(problems).toEqual([])
        expect(sql).toContain('JOIN')
        await run(sql, `join ${tableKey(a)} to ${tableKey(b)}`)
        joined++
      }
    }
    // Every mock declares at least one foreign key; a count of zero would mean the schema lost them.
    expect(joined).toBeGreaterThan(0)
  }, 300_000)
})
