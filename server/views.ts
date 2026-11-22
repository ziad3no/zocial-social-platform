/** Queries that turn rows into the shapes the client receives. */
import { canDeleteComment, canDeletePost, canEditComment, canEditPost, type Viewer } from '../shared/rules'
import { REACTIONS, type Reaction } from '../shared/schemas'
import type { CommentView, PostView, UserSummary } from '../shared/types'
import { avatarUrl } from './auth'
import { decodeCursor, encodeCursor, type DB } from './db'

interface PostRecord {
  id: number
  author_id: number
  body: string
  media_id: number | null
  created_at: string
  edited_at: string | null
  username: string
  display_name: string
  avatar_media_id: number | null
  comment_count: number
  my_reaction: Reaction | null
}

const POST_SELECT = `
  SELECT p.id, p.author_id, p.body, p.media_id, p.created_at, p.edited_at,
         u.username, u.display_name, u.avatar_media_id,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         (SELECT r.type FROM reactions r WHERE r.post_id = p.id AND r.user_id = ?) AS my_reaction
  FROM posts p JOIN users u ON u.id = p.author_id`

const summary = (r: { author_id: number; username: string; display_name: string; avatar_media_id: number | null }): UserSummary => ({
  id: r.author_id,
  username: r.username,
  displayName: r.display_name,
  avatarUrl: avatarUrl(r.avatar_media_id),
})

function emptyReactions(): Record<Reaction, number> {
  return Object.fromEntries(REACTIONS.map((r) => [r, 0])) as Record<Reaction, number>
}

function toPostViews(db: DB, viewer: Viewer, rows: PostRecord[]): PostView[] {
  const counts = new Map<number, Record<Reaction, number>>()
  if (rows.length) {
    const ids = rows.map((r) => r.id)
    const agg = db
      .prepare(`SELECT post_id, type, COUNT(*) AS n FROM reactions WHERE post_id IN (${ids.map(() => '?').join(',')}) GROUP BY post_id, type`)
      .all(...ids) as { post_id: number; type: Reaction; n: number }[]
    for (const row of agg) {
      const entry = counts.get(row.post_id) ?? emptyReactions()
      entry[row.type] = row.n
      counts.set(row.post_id, entry)
    }
  }
  return rows.map((r) => ({
    id: r.id,
    author: summary(r),
    body: r.body,
    imageUrl: r.media_id ? `/api/media/${r.media_id}` : null,
    createdAt: r.created_at,
    editedAt: r.edited_at,
    reactions: counts.get(r.id) ?? emptyReactions(),
    myReaction: r.my_reaction,
    commentCount: r.comment_count,
    canEdit: canEditPost(viewer, { authorId: r.author_id }),
    canDelete: canDeletePost(viewer, { authorId: r.author_id }),
  }))
}

export function getPostView(db: DB, viewer: Viewer, id: number): PostView | null {
  const row = db.prepare(`${POST_SELECT} WHERE p.id = ?`).get(viewer.id, id) as PostRecord | undefined
  return row ? toPostViews(db, viewer, [row])[0]! : null
}

/** Newest first. Pass the previous nextCursor to continue. */
export function listPosts(db: DB, viewer: Viewer, opts: { cursor?: string; limit: number; authorId?: number }) {
  const where: string[] = []
  const params: (string | number)[] = [viewer.id]
  if (opts.authorId) (where.push('p.author_id = ?'), params.push(opts.authorId))
  const cursor = decodeCursor(opts.cursor)
  if (cursor) (where.push('(p.created_at, p.id) < (?, ?)'), params.push(cursor.createdAt, cursor.id))
  const rows = db
    .prepare(`${POST_SELECT} ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .all(...params, opts.limit + 1) as unknown as PostRecord[]
  const hasMore = rows.length > opts.limit
  const page = rows.slice(0, opts.limit)
  const last = page.at(-1)
  return {
    items: toPostViews(db, viewer, page),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  }
}

interface CommentRecord {
  id: number
  post_id: number
  author_id: number
  body: string
  created_at: string
  edited_at: string | null
  username: string
  display_name: string
  avatar_media_id: number | null
  post_author_id: number
}

const COMMENT_SELECT = `
  SELECT c.id, c.post_id, c.author_id, c.body, c.created_at, c.edited_at,
         u.username, u.display_name, u.avatar_media_id, p.author_id AS post_author_id
  FROM comments c JOIN users u ON u.id = c.author_id JOIN posts p ON p.id = c.post_id`

const toCommentView = (viewer: Viewer, r: CommentRecord): CommentView => ({
  id: r.id,
  postId: r.post_id,
  author: summary(r),
  body: r.body,
  createdAt: r.created_at,
  editedAt: r.edited_at,
  canEdit: canEditComment(viewer, { authorId: r.author_id }),
  canDelete: canDeleteComment(viewer, { authorId: r.author_id }, { authorId: r.post_author_id }),
})

export function getCommentRecord(db: DB, id: number) {
  return db.prepare(`${COMMENT_SELECT} WHERE c.id = ?`).get(id) as CommentRecord | undefined
}

export function getCommentView(db: DB, viewer: Viewer, id: number): CommentView | null {
  const row = getCommentRecord(db, id)
  return row ? toCommentView(viewer, row) : null
}

/** Oldest first, so a conversation reads top to bottom. */
export function listComments(db: DB, viewer: Viewer, postId: number, opts: { cursor?: string; limit: number }) {
  const params: (string | number)[] = [postId]
  let cursorSql = ''
  const cursor = decodeCursor(opts.cursor)
  if (cursor) {
    cursorSql = 'AND (c.created_at, c.id) > (?, ?)'
    params.push(cursor.createdAt, cursor.id)
  }
  const rows = db
    .prepare(`${COMMENT_SELECT} WHERE c.post_id = ? ${cursorSql} ORDER BY c.created_at, c.id LIMIT ?`)
    .all(...params, opts.limit + 1) as unknown as CommentRecord[]
  const hasMore = rows.length > opts.limit
  const page = rows.slice(0, opts.limit)
  const last = page.at(-1)
  return {
    items: page.map((r) => toCommentView(viewer, r)),
    nextCursor: hasMore && last ? encodeCursor(last.created_at, last.id) : null,
  }
}
