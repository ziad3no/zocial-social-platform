import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

export type DB = DatabaseSync

/** Schema. docs/database.md explains each table, index and delete rule. */
export const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id              INTEGER PRIMARY KEY,
  username        TEXT    NOT NULL UNIQUE COLLATE NOCASE,
  display_name    TEXT    NOT NULL,
  bio             TEXT    NOT NULL DEFAULT '',
  avatar_media_id INTEGER REFERENCES media(id) ON DELETE SET NULL,
  password_hash   TEXT    NOT NULL,
  is_demo         INTEGER NOT NULL DEFAULT 0,
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
  id         INTEGER PRIMARY KEY,
  owner_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mime       TEXT    NOT NULL CHECK (mime IN ('image/jpeg', 'image/png', 'image/webp', 'image/gif')),
  bytes      BLOB    NOT NULL,
  size       INTEGER NOT NULL,
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_media_owner ON media(owner_id);

CREATE TABLE IF NOT EXISTS posts (
  id         INTEGER PRIMARY KEY,
  author_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT    NOT NULL DEFAULT '',
  media_id   INTEGER REFERENCES media(id) ON DELETE SET NULL,
  created_at TEXT    NOT NULL,
  edited_at  TEXT
);
CREATE INDEX IF NOT EXISTS idx_posts_feed   ON posts(created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_posts_author ON posts(author_id, created_at DESC, id DESC);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY,
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
`

export function openDb(file: string): DB {
  if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true })
  const db = new DatabaseSync(file)
  db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;')
  if (file !== ':memory:') db.exec('PRAGMA journal_mode = WAL;')
  db.exec(SCHEMA)
  return db
}

export function transaction<T>(db: DB, fn: () => T): T {
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
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
