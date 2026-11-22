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
import { nowIso, type DB, type Queryable } from '../db'
import { conflict, HttpError, notFound, parse } from '../http'
import { deleteMedia, singleImage, storeImage } from '../media'

export function authRoutes(db: DB, options: AppOptions) {
  const router = Router()
  const limiter = createLoginLimiter()
  const byUsername = (username: string) => db.get<UserRecord>('SELECT * FROM users WHERE username = ?', [username])

  const startSession = async (res: Response, userId: number) =>
    setSessionCookie(res, await createSession(db, userId), options.secureCookies)

  router.post('/register', async (req, res) => {
    const input = parse(registerSchema, req.body)
    if (await byUsername(input.username)) {
      throw conflict('That username is taken.', { username: 'That username is taken. Try another.' })
    }
    const user = await db.get<UserRecord>(
      'INSERT INTO users (username, display_name, password_hash, created_at) VALUES (?, ?, ?, ?) RETURNING *',
      [input.username, input.displayName, await hashPassword(input.password), nowIso()],
    )
    await startSession(res, user!.id)
    res.status(201).json({ user: toSessionUser(user!) })
  })

  router.post('/login', async (req, res) => {
    const input = parse(loginSchema, req.body)
    const key = `${req.ip}|${input.username}`
    limiter.check(key)
    const user = await byUsername(input.username)
    if (!user || !(await verifyPassword(input.password, user.password_hash))) {
      limiter.fail(key)
      throw new HttpError(401, 'Username or password is incorrect.')
    }
    limiter.reset(key)
    await startSession(res, user.id)
    res.json({ user: toSessionUser(user) })
  })

  router.post('/demo', async (req, res) => {
    if (!options.demoLogin) throw notFound('Demo sign-in')
    const { username } = parse(demoLoginSchema, req.body)
    const user = await db.get<UserRecord>('SELECT * FROM users WHERE username = ? AND is_demo', [username])
    if (!user) throw notFound('That demo account')
    await startSession(res, user.id)
    res.json({ user: toSessionUser(user) })
  })

  router.post('/logout', async (req, res) => {
    if (req.sessionHash) await db.run('DELETE FROM sessions WHERE token_hash = ?', [req.sessionHash])
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
  const reload = async (id: number) => toSessionUser((await db.get<UserRecord>('SELECT * FROM users WHERE id = ?', [id]))!)
  const currentAvatar = async (q: Queryable, id: number) =>
    (await q.get<{ id: number | null }>('SELECT avatar_media_id AS id FROM users WHERE id = ?', [id]))?.id ?? null

  router.patch('/', async (req, res) => {
    const input = parse(profileSchema, req.body)
    await db.run('UPDATE users SET display_name = ?, bio = ? WHERE id = ?', [input.displayName, input.bio, req.user!.id])
    res.json({ user: await reload(req.user!.id) })
  })

  router.put('/avatar', singleImage('image'), async (req, res) => {
    if (!req.file) throw new HttpError(400, 'Choose an image to upload.', { image: 'Choose an image to upload.' })
    const me = req.user!
    await db.tx(async (t) => {
      const old = await currentAvatar(t, me.id)
      const mediaId = await storeImage(t, me.id, req.file!)
      await t.run('UPDATE users SET avatar_media_id = ? WHERE id = ?', [mediaId, me.id])
      await deleteMedia(t, old)
    })
    res.json({ user: await reload(me.id) })
  })

  router.delete('/avatar', async (req, res) => {
    const me = req.user!
    const old = await currentAvatar(db, me.id)
    await db.run('UPDATE users SET avatar_media_id = NULL WHERE id = ?', [me.id])
    await deleteMedia(db, old)
    res.json({ user: await reload(me.id) })
  })

  return router
}

export function userRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)
  router.get('/:username', async (req, res) => {
    const row = await db.get<{
      id: number
      username: string
      display_name: string
      bio: string
      avatar_media_id: number | null
      created_at: string
      post_count: number
      reactions_received: number
    }>(
      `SELECT u.id, u.username, u.display_name, u.bio, u.avatar_media_id, u.created_at,
              (SELECT COUNT(*)::int FROM posts p WHERE p.author_id = u.id) AS post_count,
              (SELECT COUNT(*)::int FROM reactions r JOIN posts p ON p.id = r.post_id WHERE p.author_id = u.id) AS reactions_received
       FROM users u WHERE u.username = ?`,
      [String(req.params.username).toLowerCase()],
    )
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
