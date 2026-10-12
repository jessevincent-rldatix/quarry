import { describe, expect, it } from 'vitest'
import type { DbCall, RecordedRequest } from './profiler'
import { collapsePath, dbWallMs, fingerprint, normaliseRoute, stats, summarise } from './profilerAnalysis'

const call = (sql: string, ms: number, offsetMs = 0, store = 'mssql'): DbCall => ({ store, sql, ms, offsetMs, rows: 1 })

let next = 0
const request = (patch: Partial<RecordedRequest>): RecordedRequest => ({
  id: `r${next++}`, method: 'GET', route: '/api/trips/{id}', path: '/api/trips/1', query: '', status: 200, ms: 100, startedAt: next * 10_000, aborted: false, db: [], ...patch,
})

describe('query fingerprints', () => {
  it('treats the same query with different values as one', () => {
    expect(fingerprint("SELECT * FROM t WHERE id = 5 AND name = 'O''Brien'")).toBe(fingerprint('select *\n  from t where id = 912 and name = \'x\''))
    expect(fingerprint('SELECT * FROM t WHERE id IN (1, 2, 3)')).toBe(fingerprint('SELECT * FROM t WHERE id IN (4)'))
    expect(fingerprint('SELECT * FROM t WHERE id = @id')).toBe(fingerprint('SELECT * FROM t WHERE id = :1'))
  })

  it('keeps different queries apart', () => {
    expect(fingerprint('SELECT a FROM t')).not.toBe(fingerprint('SELECT b FROM t'))
  })
})

describe('routes', () => {
  it('collapses ids in paths that matched no route', () => {
    expect(collapsePath('/api/trips/42/legs/3f2504e0-4f89-11d3-9a0c-0305e82c3301')).toBe('/api/trips/{id}/legs/{id}')
    expect(collapsePath('/api/v2/trips')).toBe('/api/v2/trips')
  })

  it('compares templates from different sources', () => {
    expect(normaliseRoute('api/Trips/{id:int}')).toBe(normaliseRoute('/api/trips/{tripId}/'))
  })
})

describe('numbers', () => {
  it('finds the median of odd and even sets', () => {
    expect(stats([5, 1, 3]).median).toBe(3)
    expect(stats([4, 1, 3, 2]).median).toBe(2.5)
  })

  it('counts overlapping queries once', () => {
    expect(dbWallMs([call('a', 100, 0), call('b', 100, 50), call('c', 10, 300)])).toBe(160)
    expect(dbWallMs([call('a', 100, 0), call('b', 10, 20)])).toBe(100)
  })
})

describe('recording summary', () => {
  it('leaves abandoned requests out of every number', () => {
    const summary = summarise([request({ ms: 100 }), request({ ms: 5, aborted: true }), request({ ms: 300 })])
    expect(summary.aborted).toBe(1)
    expect(summary.endpoints[0].calls).toBe(2)
    expect(summary.endpoints[0].aborted).toBe(1)
    expect(summary.endpoints[0].ms.median).toBe(200)
  })

  it('drops an endpoint that was only ever abandoned', () => {
    expect(summarise([request({ aborted: true })]).endpoints).toEqual([])
  })

  it('collapses identical requests, and calls it a double fire only when the copies overlapped', () => {
    const summary = summarise([
      request({ path: '/api/trips/1', startedAt: 1000 }),
      request({ path: '/api/trips/1', startedAt: 1040 }),
      request({ path: '/api/trips/1', startedAt: 60_000 }),
      request({ path: '/api/trips/2', startedAt: 2000, ms: 20 }),
      request({ path: '/api/trips/2', startedAt: 2060, ms: 20 }),
      request({ path: '/api/trips/2', query: 'full=true', startedAt: 90_000 }),
    ])
    const [endpoint] = summary.endpoints
    expect(endpoint.calls).toBe(6)
    expect(endpoint.variants.map((v) => [v.path, v.query, v.count, v.doubleFired]).sort()).toEqual([
      ['/api/trips/1', '', 3, true], ['/api/trips/2', '', 2, false], ['/api/trips/2', 'full=true', 1, false],
    ])
    expect(summary.duplicates).toBe(3)
  })

  it('flags an N+1 and reports how often a typical request runs each query', () => {
    const child = (id: number) => call(`SELECT * FROM legs WHERE trip_id = ${id}`, 4, id * 5)
    const summary = summarise([
      request({ db: [call('SELECT * FROM trips', 20), ...[1, 2, 3, 4, 5, 6].map(child)] }),
      request({ db: [call('SELECT * FROM trips', 22), ...[1, 2, 3, 4].map(child)] }),
    ])
    const [endpoint] = summary.endpoints
    expect(endpoint.flags).toContain('n+1')
    const legs = endpoint.queries.find((q) => q.sql.includes('legs'))!
    expect([legs.perCall, legs.maxPerCall, legs.total, legs.nPlusOne]).toEqual([5, 6, 10, true])
    expect(endpoint.queries.find((q) => q.sql.includes('FROM trips'))!.nPlusOne).toBe(false)
    expect(endpoint.queriesPerCall).toBe(6)
  })

  it('separates a slow database from slow application code', () => {
    const dbBound = summarise([request({ ms: 2000, db: [call('SELECT slow', 1900, 50)] })]).endpoints[0]
    expect(dbBound.flags).toEqual(expect.arrayContaining(['slow', 'slow-query', 'db-heavy']))
    const appBound = summarise([request({ ms: 2000, db: [call('SELECT quick', 20, 50)] })]).endpoints[0]
    expect(appBound.flags).toEqual(['slow'])
    expect(appBound.dbShare).toBeCloseTo(0.01)
  })

  it('lists declared routes the recording never reached, whatever the spelling', () => {
    const summary = summarise([request({ route: 'api/Trips/{id:int}' })], [
      { method: 'GET', route: '/api/trips/{tripId}' }, { method: 'POST', route: '/api/trips' }, { method: 'GET', route: '/api/vehicles' },
    ])
    expect(summary.notReached).toEqual([{ method: 'POST', route: '/api/trips' }, { method: 'GET', route: '/api/vehicles' }])
  })

  it('ranks endpoints slowest first', () => {
    const summary = summarise([request({ route: '/fast', ms: 10 }), request({ route: '/slow', ms: 900 }), request({ route: '/mid', ms: 200 })])
    expect(summary.endpoints.map((e) => e.route)).toEqual(['/slow', '/mid', '/fast'])
  })
})
