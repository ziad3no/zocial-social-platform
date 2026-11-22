/**
 * Vercel entry point. `npm run build:api` bundles this file into api/index.mjs,
 * which Vercel runs as a serverless function for every /api request (see
 * vercel.json). The database connection and the Express app are created once
 * per function instance and reused between requests.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from './app'
import { readConfig } from './config'
import { openDb } from './db'
import { ensureSeeded } from './seed'

const config = readConfig()

const ready = (async () => {
  if (!config.databaseUrl) throw new Error('Set POSTGRES_URL or DATABASE_URL (connect a Supabase database in Vercel).')
  const db = await openDb({ url: config.databaseUrl })
  await ensureSeeded(db)
  return createApp(db, { demoLogin: config.demoLogin, secureCookies: true, demoResetHours: config.demoResetHours })
})()

// Keep a failed start-up from crashing the function; the error is reported per request instead.
ready.catch((err) => console.error(err))

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  try {
    const app = await ready
    app(req as never, res as never)
  } catch (err) {
    res.statusCode = 503
    res.setHeader('Content-Type', 'application/json')
    res.end(JSON.stringify({ error: { message: (err as Error).message } }))
  }
}
