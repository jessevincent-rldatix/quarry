import { describe, expect, it } from 'vitest'
import type { ConnectionInput } from '@shared/types'
import { parseConnectionString } from './connectionString'

// Every password here is invented for the test.
const CASES: { name: string; text: string; expected: Partial<ConnectionInput> }[] = [
  {
    name: 'SQL Server with a port after the comma',
    text: 'Server=127.0.0.1,14333;Database=fleetdesk;User Id=fleet_reader;Password=not-a-real-pw;',
    expected: { dialect: 'mssql', host: '127.0.0.1', port: 14333, database: 'fleetdesk', user: 'fleet_reader', password: 'not-a-real-pw' },
  },
  {
    name: 'SQL Server without a port',
    text: 'Server=db.example.test;Database=fleetdesk;User Id=fleet_reader;Password=not-a-real-pw',
    expected: { dialect: 'mssql', host: 'db.example.test', port: undefined, database: 'fleetdesk', user: 'fleet_reader', password: 'not-a-real-pw' },
  },
  {
    name: 'SQL Server with the tcp: prefix, other key spellings and mixed case',
    text: 'data source=tcp:db.example.test,1444; Initial Catalog=fleetdesk; UID=fleet_reader; PWD=not-a-real-pw',
    expected: { dialect: 'mssql', host: 'db.example.test', port: 1444, database: 'fleetdesk', user: 'fleet_reader', password: 'not-a-real-pw' },
  },
  {
    name: 'SQL Server with encrypt on and the certificate trusted',
    text: 'Server=127.0.0.1;Database=fleetdesk;User Id=sa;Password=not-a-real-pw;Encrypt=True;TrustServerCertificate=True',
    expected: { dialect: 'mssql', host: '127.0.0.1', encrypt: true, trustServerCertificate: true },
  },
  {
    name: 'SQL Server with encrypt off and the certificate not trusted',
    text: 'Server=127.0.0.1;Database=fleetdesk;User Id=sa;Password=not-a-real-pw;Encrypt=false;Trust Server Certificate=no',
    expected: { dialect: 'mssql', encrypt: false, trustServerCertificate: false },
  },
  {
    name: 'SQL Server that says nothing about encryption leaves both flags unset',
    text: 'Server=127.0.0.1;Database=fleetdesk;User Id=sa;Password=not-a-real-pw',
    expected: { encrypt: undefined, trustServerCertificate: undefined },
  },
  {
    name: 'SQL Server password containing an equals sign',
    text: 'Server=127.0.0.1;Database=fleetdesk;User Id=sa;Password=made=up=pw',
    expected: { password: 'made=up=pw' },
  },
  {
    name: 'SQL Server with no password',
    text: 'Server=127.0.0.1,14333;Database=fleetdesk;User Id=fleet_reader',
    expected: { dialect: 'mssql', host: '127.0.0.1', port: 14333, database: 'fleetdesk', user: 'fleet_reader', password: undefined },
  },
  {
    name: 'postgres:// with encoded characters in the password',
    text: 'postgres://grower:p%40ss%3Aw%2Frd%23%25%20x@127.0.0.1:15432/greenhouse',
    expected: { dialect: 'postgres', host: '127.0.0.1', port: 15432, database: 'greenhouse', user: 'grower', password: 'p@ss:w/rd#% x' },
  },
  {
    name: 'postgresql:// without a port',
    text: 'postgresql://grower:not-a-real-pw@db.example.test/greenhouse',
    expected: { dialect: 'postgres', host: 'db.example.test', port: undefined, database: 'greenhouse', user: 'grower', password: 'not-a-real-pw' },
  },
  {
    name: 'postgres:// with no password',
    text: 'postgres://grower@127.0.0.1:15432/greenhouse',
    expected: { dialect: 'postgres', host: '127.0.0.1', port: 15432, database: 'greenhouse', user: 'grower', password: undefined },
  },
  {
    name: 'mysql:// with encoded characters in the user and password',
    text: 'mysql://green%2Dhouse:inv%C3%A9nt%26ed%3F@127.0.0.1:13306/greenhouse',
    expected: { dialect: 'mysql', host: '127.0.0.1', port: 13306, database: 'greenhouse', user: 'green-house', password: 'invént&ed?' },
  },
  {
    name: 'mariadb:// is read as MySQL',
    text: 'mariadb://grower:not-a-real-pw@127.0.0.1/greenhouse',
    expected: { dialect: 'mysql', host: '127.0.0.1', database: 'greenhouse' },
  },
  {
    name: 'a URL with no database',
    text: 'mysql://grower:not-a-real-pw@127.0.0.1:13306',
    expected: { dialect: 'mysql', host: '127.0.0.1', port: 13306, database: undefined },
  },
  {
    name: 'surrounding whitespace is ignored',
    text: '  postgres://grower:not-a-real-pw@127.0.0.1/greenhouse \n',
    expected: { dialect: 'postgres', host: '127.0.0.1', database: 'greenhouse', password: 'not-a-real-pw' },
  },
]

describe('parseConnectionString', () => {
  it.each(CASES)('$name', ({ text, expected }) => {
    const parsed = parseConnectionString(text)
    expect(parsed).not.toBeNull()
    expect(parsed).toMatchObject(expected)
    // toMatchObject treats a missing key and an undefined one alike, which is what the form needs.
    for (const [key, value] of Object.entries(expected)) {
      if (value === undefined) expect(parsed![key as keyof ConnectionInput]).toBeUndefined()
    }
  })

  it.each(CASES)('never keeps the raw string: $name', ({ text }) => {
    const parsed = parseConnectionString(text)!
    const raw = text.trim()
    for (const value of Object.values(parsed)) {
      expect(value).not.toBe(raw)
      if (typeof value === 'string') expect(value).not.toContain(raw)
    }
    // No field may carry the password along with something else, such as a host of "user:pw@host".
    if (parsed.password) {
      const others = Object.entries(parsed).filter(([key]) => key !== 'password').map(([, value]) => String(value))
      for (const other of others) expect(other).not.toContain(parsed.password)
    }
    expect(Object.keys(parsed).sort()).toEqual(expect.arrayContaining(['dialect', 'host']))
    for (const key of Object.keys(parsed)) {
      expect(['dialect', 'host', 'port', 'database', 'user', 'password', 'encrypt', 'trustServerCertificate']).toContain(key)
    }
  })

  it.each(['', '   ', 'just some words', 'Database=fleetdesk;User Id=sa', 'http://example.test/db', 'select 1'])('returns null for %j', (text) => {
    expect(parseConnectionString(text)).toBeNull()
  })

  it('does not throw on a password with a stray percent sign', () => {
    expect(parseConnectionString('postgres://grower:50%off@127.0.0.1/greenhouse')).toMatchObject({ host: '127.0.0.1', password: '50%off' })
  })
})
