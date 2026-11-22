import { join, resolve } from 'node:path'
import { createApp } from './app'
import { readConfig } from './config'
import { openDb } from './db'
import { ensureSeeded } from './seed'

try {
  process.loadEnvFile()
} catch {
  // .env is optional
}

const config = readConfig()
// In development Vite owns PORT-like settings, so the API uses API_PORT (default 3002).
const port = Number(config.production ? (process.env.PORT ?? 3002) : (process.env.API_PORT ?? 3002))

const db = await openDb({ url: config.databaseUrl, dataDir: join(resolve(config.dataDir), 'pglite') })
await ensureSeeded(db)

const app = createApp(db, {
  demoLogin: config.demoLogin,
  secureCookies: config.production,
  clientDir: resolve('dist'),
  demoResetHours: config.demoResetHours,
})

app.listen(port, () => {
  const where = config.databaseUrl ? 'Postgres' : 'local PGlite database in ' + config.dataDir
  console.log(`Zocial API on http://localhost:${port} using ${where}${config.production ? '' : ' (open the app at http://localhost:5175)'}`)
})
