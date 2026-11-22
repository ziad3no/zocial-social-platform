/**
 * PostgreSQL access. In production the app talks to Supabase (or any
 * Postgres) through DATABASE_URL / POSTGRES_URL. Locally and in the tests it
 * runs PGlite, a full Postgres compiled to WebAssembly, so there is nothing
 * to install. Both speak the same SQL, so the queries are identical.
 */
import { mkdirSync } from 'node:fs'
import pg from 'pg'

export interface Queryable {
  all<T>(sql: string, params?: unknown[]): Promise<T[]>
  get<T>(sql: string, params?: unknown[]): Promise<T | undefined>
  run(sql: string, params?: unknown[]): Promise<{ rowCount: number }>
  exec(sql: string): Promise<void>
}

export interface DB extends Queryable {
  tx<T>(fn: (t: Queryable) => Promise<T>): Promise<T>
  close(): Promise<void>
}

/** Queries are written with "?" placeholders; Postgres wants $1, $2, … */
export const toPg = (sql: string) => {
  let i = 0
  return sql.replace(/\?/g, () => `$${++i}`)
}

// COUNT(*) and other bigint results arrive as strings from node-postgres; numbers are easier to use.
pg.types.setTypeParser(20, (v) => Number.parseInt(v, 10))

type PgClient = pg.Pool | pg.PoolClient

function pgQueryable(c: PgClient): Queryable {
  return {
    all: async <T>(sql: string, params: unknown[] = []) => (await c.query(toPg(sql), params)).rows as T[],
    get: async <T>(sql: string, params: unknown[] = []) => (await c.query(toPg(sql), params)).rows[0] as T | undefined,
    run: async (sql: string, params: unknown[] = []) => ({ rowCount: (await c.query(toPg(sql), params)).rowCount ?? 0 }),
    exec: async (sql: string) => {
      await c.query(sql)
    },
  }
}

function connectPostgres(url: string): DB {
  // Hosted Postgres (Supabase) uses TLS with its own certificate chain, and some
  // connection strings carry sslmode/pooler hints that node-postgres would
  // interpret too strictly. TLS is configured here instead.
  const u = new URL(url)
  for (const key of ['sslmode', 'supa', 'pgbouncer']) u.searchParams.delete(key)
  const local = ['localhost', '127.0.0.1'].includes(u.hostname)
  const pool = new pg.Pool({
    connectionString: u.toString(),
    ssl: local ? undefined : { rejectUnauthorized: false },
    max: 3,
    idleTimeoutMillis: 10_000,
  })
  return {
    ...pgQueryable(pool),
    async tx(fn) {
      const client = await pool.connect()
      try {
        await client.query('BEGIN')
        const result = await fn(pgQueryable(client))
        await client.query('COMMIT')
        return result
      } catch (err) {
        await client.query('ROLLBACK')
        throw err
      } finally {
        client.release()
      }
    },
    close: () => pool.end(),
  }
}

async function startPglite(dataDir?: string): Promise<DB> {
  const { PGlite } = await import('@electric-sql/pglite')
  if (dataDir) mkdirSync(dataDir, { recursive: true })
  const db = new PGlite(dataDir)
  await db.waitReady
  type Q = Pick<InstanceType<typeof PGlite>, 'query' | 'exec'>
  const wrap = (c: Q): Queryable => ({
    all: async <T>(sql: string, params: unknown[] = []) => (await c.query<T>(toPg(sql), params)).rows,
    get: async <T>(sql: string, params: unknown[] = []) => (await c.query<T>(toPg(sql), params)).rows[0],
    run: async (sql: string, params: unknown[] = []) => ({ rowCount: (await c.query(toPg(sql), params)).affectedRows ?? 0 }),
    exec: async (sql: string) => {
      await c.exec(sql)
    },
  })
  return {
    ...wrap(db),
    tx: (fn) => db.transaction((t) => fn(wrap(t))),
    close: () => db.close(),
  }
}

/** Schema. Created on start-up; safe to run many times. See docs/database.md. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              SERIAL  PRIMARY KEY,
  username        TEXT    NOT NULL UNIQUE,
  display_name    TEXT    NOT NULL,
  bio             TEXT    NOT NULL DEFAULT '',
  avatar_media_id INTEGER,
  password_hash   TEXT    NOT NULL,
  is_demo         BOOLEAN NOT NULL DEFAULT FALSE,
  created_at      TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT    PRIMARY KEY,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  expires_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS media (
  id         SERIAL  PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT    NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  bytes      BYTEA   NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);

-- users and media point at each other, so this foreign key is added after both exist.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_avatar_media_fk') THEN
    ALTER TABLE users ADD CONSTRAINT users_avatar_media_fk
      FOREIGN KEY (avatar_media_id) REFERENCES media(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS posts (
  id         SERIAL  PRIMARY KEY,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL DEFAULT '',
  media_id   INTEGER REFERENCES media(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL,
  edited_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_feed   ON posts(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS comments (
  id         SERIAL  PRIMARY KEY,
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  edited_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_comments_post ON comments(post_id, created_at, id);

CREATE TABLE IF NOT EXISTS reactions (
  post_id    INTEGER NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL CHECK (type IN ('like', 'love', 'laugh', 'wow', 'sad')),
  created_at TEXT    NOT NULL,
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_reactions_user ON reactions(user_id);

CREATE TABLE IF NOT EXISTS app_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

/** Lock id used so two servers starting at once don't create tables or seed twice. */
export const SETUP_LOCK = 7_241_002

export async function openDb(options: { url?: string; dataDir?: string } = {}): Promise<DB> {
  const db = options.url ? connectPostgres(options.url) : await startPglite(options.dataDir)
  await db.tx(async (t) => {
    await t.get('SELECT pg_advisory_xact_lock(?)', [SETUP_LOCK])
    await t.exec(SCHEMA)
  })
  return db
}

export const nowIso = () => new Date().toISOString()

// ---------- cursors ----------
// A cursor is the (created_at, id) of the last item the client has, encoded
// so it is opaque. Using both columns keeps the order stable when two rows
// share a timestamp, and new posts arriving don't shift later pages.

export function encodeCursor(createdAt: string, id: number) {
  return Buffer.from(`${createdAt}|${id}`).toString('base64url')
}

export function decodeCursor(cursor: string | undefined): { createdAt: string; id: number } | null {
  if (!cursor) return null
  const [createdAt, id] = Buffer.from(cursor, 'base64url').toString().split('|')
  const n = Number(id)
  if (!createdAt || !/^\d{4}-\d{2}-\d{2}T/.test(createdAt) || !Number.isInteger(n)) return null
  return { createdAt, id: n }
}
