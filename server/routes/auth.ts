import { Router, type Response } from 'express'
import { demoLoginSchema, loginSchema, profileSchema, registerSchema } from '../../shared/schemas'
import type { Profile } from '../../shared/types'
import type { AppOptions } from '../app'
import {
  avatarUrl,
  clearSessionCookie,
  createLoginLimiter,
  createSession,
  hashPassword,
  requireAuth,
  setSessionCookie,
  toSessionUser,
  verifyPassword,
  type UserRecord,
} from '../auth'
import { nowIso, transaction, type DB } from '../db'
import { conflict, HttpError, notFound, parse } from '../http'
import { deleteMedia, singleImage, storeImage } from '../media'

export function authRoutes(db: DB, options: AppOptions) {
  const router = Router()
  const limiter = createLoginLimiter()
  const byUsername = db.prepare('SELECT * FROM users WHERE username = ?')

  const startSession = (res: Response, userId: number) => setSessionCookie(res, createSession(db, userId), options.secureCookies)

  router.post('/register', async (req, res) => {
    const input = parse(registerSchema, req.body)
    if (byUsername.get(input.username)) {
      throw conflict('That username is taken.', { username: 'That username is taken. Try another.' })
    }
    const { lastInsertRowid } = db
      .prepare('INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?)')
      .run(input.username, input.displayName, await hashPassword(input.password), nowIso())
    startSession(res, Number(lastInsertRowid))
    res.status(201).json({ user: toSessionUser(byUsername.get(input.username) as unknown as UserRecord) })
  })

  router.post('/login', async (req, res) => {
    const input = parse(loginSchema, req.body)
    const key = `${req.ip}|${input.username}`
    limiter.check(key)
    const user = byUsername.get(input.username) as UserRecord | undefined
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      limiter.fail(key)
      throw new HttpError(401, 'Username or password is incorrect.')
    }
    limiter.reset(key)
    startSession(res, user.id)
    res.json({ user: toSessionUser(user) })
  })

  router.post('/demo', (req, res) => {
    if (!options.demoLogin) throw notFound('Demo sign-in')
    const { username } = parse(demoLoginSchema, req.body)
    const user = db.prepare('SELECT * FROM users WHERE username = ? AND is_demo = 1').get(username) as UserRecord | undefined
    if (!user) throw notFound('That demo account')
    startSession(res, user.id)
    res.json({ user: toSessionUser(user) })
  })

  router.post('/logout', (req, res) => {
    if (req.sessionHash) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(req.sessionHash)
    clearSessionCookie(res, options.secureCookies)
    res.status(204).end()
  })

  router.get('/me', requireAuth, (req, res) => {
    res.json({ user: req.user })
  })

  return router
}

/** The signed-in user's own profile. There is no route to edit anyone else's. */
export function meRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)
  const reload = (id: number) => toSessionUser(db.prepare('SELECT * FROM users WHERE id = ?').get(id) as unknown as UserRecord)

  router.patch('/', (req, res) => {
    const input = parse(profileSchema, req.body)
    db.prepare('UPDATE users SET display_name = ?, bio = ? WHERE id = ?').run(input.displayName, input.bio, req.user!.id)
    res.json({ user: reload(req.user!.id) })
  })

  router.put('/avatar', singleImage('image'), (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose an image to upload.', { image: 'Choose an image to upload.' })
    const me = req.user!
    transaction(db, () => {
      const old = db.prepare('SELECT avatar_media_id AS id FROM users WHERE id = ?').get(me.id) as { id: number | null }
      const mediaId = storeImage(db, me.id, req.file!)
      db.prepare('UPDATE users SET avatar_media_id = ? WHERE id = ?').run(mediaId, me.id)
      deleteMedia(db, old.id)
    })
    res.json({ user: reload(me.id) })
  })

  router.delete('/avatar', (req, res) => {
    const me = req.user!
    const old = db.prepare('SELECT avatar_media_id AS id FROM users WHERE id = ?').get(me.id) as { id: number | null }
    db.prepare('UPDATE users SET avatar_media_id = NULL WHERE id = ?').run(me.id)
    deleteMedia(db, old.id)
    res.json({ user: reload(me.id) })
  })

  return router
}

export function userRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)
  router.get('/:username', (req, res) => {
    const row = db
      .prepare(
        `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_media_id, u.created_at,
                (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) AS post_count,
                (SELECT COUNT(*) FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.author_id = u.id) AS reactions_received
         FROM users u WHERE u.username = ?`,
      )
      .get(String(req.params.username).toLowerCase()) as
      | { id: number; username: string; display_name: string; bio: string; avatar_media_id: number | null; created_at: string; post_count: number; reactions_received: number }
      | undefined
    if (!row) throw notFound('That profile')
    const profile: Profile = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      bio: row.bio,
      avatarUrl: avatarUrl(row.avatar_media_id),
      joinedAt: row.created_at,
      postCount: row.post_count,
      reactionsReceived: row.reactions_received,
    }
    res.json({ profile })
  })
  return router
}
