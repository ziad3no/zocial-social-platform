/** npm run seed: wipe the database and load the demo data again. */
import { join, resolve } from 'node:path'
import { readConfig } from './config'
import { openDb } from './db'
import { resetDemo } from './seed'

try {
  process.loadEnvFile()
} catch {
  // .env is optional
}
const config = readConfig()
const db = await openDb({ url: config.databaseUrl, dataDir: join(resolve(config.dataDir), 'pglite') })
await resetDemo(db)
await db.close()
console.log('Database reset with demo data')
