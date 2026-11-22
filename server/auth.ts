import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import type { RequestHandler, Response } from 'express'
import type { SessionUser } from '../shared/types'
import type { DB } from './db'
import { forbidden, HttpError } from './http'

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, keylen: number) => Promise<Buffer>

export const SESSION_COOKIE = 'zocial_session'
const SESSION_DAYS = 7

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser
      sessionHash?: string
    }
  }
}

// ---------- passwords ----------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

/** Stored for seeded accounts: no password can ever match it. */
export const NO_PASSWORD = '!'

// ---------- sessions ----------

const sha256 = (value: string) => createHash('sha256').update(value).digest('hex')

/** Creates a session and returns the raw token. Only its hash is stored. */
export function createSession(db: DB, userId: number): string {
  const token = randomBytes(32).toString('base64url')
  const now = new Date()
  const expires = new Date(now.getTime() + SESSION_DAYS * 86_400_000)
  db.prepare('INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)').run(
    sha256(token),
    userId,
    now.toISOString(),
    expires.toISOString(),
  )
  return token
}

export function setSessionCookie(res: Response, token: string, secure: boolean) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure,
    path: '/',
    maxAge: SESSION_DAYS * 86_400_000,
  })
}

export function clearSessionCookie(res: Response, secure: boolean) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, sameSite: 'lax', secure, path: '/' })
}

export interface UserRecord {
  id: number
  username: string
  display_name: string
  bio: string
  avatar_media_id: number | null
  is_demo: number
  password_hash: string
}

export const avatarUrl = (mediaId: number | null) => (mediaId ? `/api/media/${mediaId}` : null)

export const toSessionUser = (u: UserRecord): SessionUser => ({
  id: u.id,
  username: u.username,
  displayName: u.display_name,
  bio: u.bio,
  avatarUrl: avatarUrl(u.avatar_media_id),
  isDemo: u.is_demo === 1,
})

/** Reads the session cookie and attaches req.user. Never fails the request. */
export function loadUser(db: DB): RequestHandler {
  const find = db.prepare(`
    SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?`)
  return (req, _res, next) => {
    const token = req.cookies?.[SESSION_COOKIE]
    if (typeof token === 'string' && token.length > 0 && token.length < 200) {
      const hash = sha256(token)
      const row = find.get(hash, new Date().toISOString()) as UserRecord | undefined
      if (row) {
        req.user = toSessionUser(row)
        req.sessionHash = hash
      }
    }
    next()
  }
}

export const requireAuth: RequestHandler = (req, _res, next) => {
  if (!req.user) throw new HttpError(401, 'Please sign in to continue.')
  next()
}

/**
 * Basic CSRF defence. Browsers will not add a custom header to a cross-site
 * form post or image request, so requiring one on every write blocks those.
 * The session cookie is also SameSite=Lax.
 */
export const requireCsrfHeader: RequestHandler = (req, _res, next) => {
  if (req.method !== 'GET' && req.method !== 'HEAD' && req.get('x-requested-with') !== 'zocial') {
    throw forbidden('Missing request header. Please reload the page and try again.')
  }
  next()
}

// ---------- login throttling ----------

/** At most `limit` failed logins per key in `windowMs`. In memory, which is fine for one server. */
export function createLoginLimiter(limit = 8, windowMs = 15 * 60_000) {
  const failures = new Map<string, { count: number; resetAt: number }>()
  return {
    check(key: string) {
      const entry = failures.get(key)
      if (entry && entry.resetAt > Date.now() && entry.count >= limit) {
        const minutes = Math.ceil((entry.resetAt - Date.now()) / 60_000)
        throw new HttpError(429, `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? '' : 's'}.`)
      }
    },
    fail(key: string) {
      const entry = failures.get(key)
      if (!entry || entry.resetAt <= Date.now()) failures.set(key, { count: 1, resetAt: Date.now() + windowMs })
      else entry.count++
    },
    reset(key: string) {
      failures.delete(key)
    },
  }
}
