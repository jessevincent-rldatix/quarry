import type { ConnectionInput } from '@shared/types'

// A stray % (a password pasted without encoding) must not throw while someone is still typing.
const decode = (part: string) => { try { return decodeURIComponent(part) } catch { return part } }

/**
 * Reads "Server=host,1433;Database=x;User Id=u;Password=p", "postgres://u:p@host:5432/db",
 * "snowflake://user:pass@account/db/schema?warehouse=wh&role=r" or a Databricks JDBC address
 * ("jdbc:databricks://host:443/default;httpPath=/sql/1.0/warehouses/id;PWD=token").
 * Only the separate parts are returned, never the string itself, so the caller can drop the text.
 */
export function parseConnectionString(text: string): Partial<ConnectionInput> | null {
  const input = text.trim()
  const databricks = /^jdbc:(?:databricks|spark):\/\/([^:/;]+)(?::\d+)?(?:\/([^;]*))?((?:;[^;]*)*)$/i.exec(input)
  if (databricks) {
    const options = new Map(databricks[3].split(';').filter(Boolean).map((part) => {
      const at = part.indexOf('=')
      return [part.slice(0, at).trim().toLowerCase(), part.slice(at + 1).trim()] as const
    }))
    if (!options.get('httppath')) return null
    // "default" in the address is the schema, and is what every copied address says, so it is not taken as a choice.
    const schema = databricks[2] && databricks[2] !== 'default' ? databricks[2] : undefined
    return { dialect: 'databricks', host: databricks[1], httpPath: options.get('httppath'), database: options.get('conncatalog') || undefined, schema: options.get('connschema') || schema, password: options.get('pwd') || undefined }
  }
  if (/^snowflake:\/\//i.test(input) && URL.canParse(input)) {
    const u = new URL(input)
    const [database, schema] = u.pathname.split('/').filter(Boolean).map(decode)
    const option = (name: string) => u.searchParams.get(name) || undefined
    const authenticator = (option('authenticator') ?? '').toLowerCase()
    return {
      dialect: 'snowflake', host: decode(u.hostname), user: decode(u.username) || undefined, password: decode(u.password) || undefined,
      database, schema, warehouse: option('warehouse'), role: option('role'),
      ...(authenticator === 'externalbrowser' ? { auth: 'sso' as const } : authenticator === 'snowflake_jwt' ? { auth: 'keypair' as const } : {}),
    }
  }
  const url = /^(postgres(?:ql)?|mysql|mariadb|sqlserver|mssql):\/\//i.exec(input)
  if (url && URL.canParse(input)) {
    const u = new URL(input)
    const scheme = url[1].toLowerCase()
    return {
      dialect: scheme.startsWith('postgres') ? 'postgres' : scheme === 'mysql' || scheme === 'mariadb' ? 'mysql' : 'mssql',
      host: u.hostname, port: u.port ? Number(u.port) : undefined, database: decode(u.pathname.replace(/^\//, '')) || undefined,
      user: decode(u.username) || undefined, password: decode(u.password) || undefined,
    }
  }
  if (!input.includes('=')) return null
  const pairs = new Map(input.split(';').map((part) => {
    const at = part.indexOf('=')
    return [part.slice(0, at).trim().toLowerCase().replace(/\s+/g, ''), part.slice(at + 1).trim()] as const
  }))
  const get = (...keys: string[]) => keys.map((k) => pairs.get(k)).find((v) => v !== undefined && v !== '')
  const server = get('server', 'datasource', 'host', 'address')
  if (!server) return null
  const [host, port] = server.replace(/^tcp:/i, '').split(',')
  const truthy = (v: string | undefined) => (v === undefined ? undefined : /^(true|yes|mandatory|strict|1)$/i.test(v))
  return {
    dialect: 'mssql', host, port: Number(port ?? get('port')) || undefined, database: get('database', 'initialcatalog'),
    user: get('userid', 'uid', 'user', 'username'), password: get('password', 'pwd'),
    encrypt: truthy(get('encrypt')), trustServerCertificate: truthy(get('trustservercertificate')),
  }
}
