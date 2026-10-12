import type { ConnectionConfig } from '../../shared/types.ts'
import { databricksDriver } from './databricks.ts'
import { mssqlDriver } from './mssql.ts'
import { mysqlDriver } from './mysql.ts'
import { postgresDriver } from './postgres.ts'
import { snowflakeDriver } from './snowflake.ts'
import { sqliteDriver } from './sqlite.ts'
import type { Driver } from './types.ts'

export function openDriver(config: ConnectionConfig, password: string): Promise<Driver> {
  switch (config.dialect) {
    case 'sqlite': return sqliteDriver(config)
    case 'mssql': return mssqlDriver(config, password)
    case 'postgres': return postgresDriver(config, password)
    case 'mysql': return mysqlDriver(config, password)
    case 'snowflake': return snowflakeDriver(config, password)
    case 'databricks': return databricksDriver(config, password)
  }
}
