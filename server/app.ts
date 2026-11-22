import { existsSync } from 'node:fs'
import { join } from 'node:path'
import cookieParser from 'cookie-parser'
import express from 'express'
import helmet from 'helmet'
import type { AppConfig, UserSummary } from '../shared/types'
import { avatarUrl, loadUser, requireCsrfHeader } from './auth'
import type { DB } from './db'
import { errorHandler, notFound } from './http'
import { mediaRoutes } from './media'
import { authRoutes, meRoutes, userRoutes } from './routes/auth'
import { commentRoutes, postRoutes } from './routes/posts'

export interface AppOptions {
  demoLogin: boolean
  secureCookies: boolean
  clientDir?: string
}

export function createApp(db: DB, options: AppOptions) {
  const app = express()
  app.disable('x-powered-by')
  app.set('trust proxy', 1)
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-origin' } }))
  app.use(express.json({ limit: '20kb' }))
  app.use(cookieParser())

  const api = express.Router()
  api.use(requireCsrfHeader)
  api.use(loadUser(db))
  api.get('/health', (_req, res) => {
    res.json({ ok: true })
  })
  api.get('/config', (_req, res) => {
    let demoAccounts: UserSummary[] = []
    if (options.demoLogin) {
      const rows = db
        .prepare('SELECT id, username, display_name, avatar_media_id FROM users WHERE is_demo = 1 ORDER BY id LIMIT 3')
        .all() as { id: number; username: string; display_name: string; avatar_media_id: number | null }[]
      demoAccounts = rows.map((r) => ({ id: r.id, username: r.username, displayName: r.display_name, avatarUrl: avatarUrl(r.avatar_media_id) }))
    }
    const config: AppConfig = { demoLogin: options.demoLogin, demoAccounts }
    res.json(config)
  })
  api.use('/auth', authRoutes(db, options))
  api.use('/me', meRoutes(db))
  api.use('/users', userRoutes(db))
  api.use('/posts', postRoutes(db))
  api.use('/comments', commentRoutes(db))
  api.use('/media', mediaRoutes(db))
  api.use(() => {
    throw notFound('That API route')
  })
  app.use('/api', api)

  if (options.clientDir && existsSync(join(options.clientDir, 'index.html'))) {
    app.use(express.static(options.clientDir, { index: false, maxAge: '1h' }))
    app.get(/^(?!\/api\/).*/, (_req, res) => {
      res.sendFile(join(options.clientDir!, 'index.html'))
    })
  }

  app.use(errorHandler)
  return app
}
