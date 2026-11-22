import { Router } from 'express'
import { canDeleteComment, canDeletePost, canEditComment, canEditPost } from '../../shared/rules'
import { commentSchema, pageQuery, postBodySchema, postEditSchema, reactionSchema } from '../../shared/schemas'
import { requireAuth } from '../auth'
import { nowIso, transaction, type DB } from '../db'
import { badRequest, forbidden, notFound, parse, parseId } from '../http'
import { deleteMedia, singleImage, storeImage } from '../media'
import { getCommentRecord, getCommentView, getPostView, listComments, listPosts } from '../views'

interface PostRow {
  id: number
  author_id: number
  body: string
  media_id: number | null
}

export function postRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  const getPost = (id: number) => {
    const post = db.prepare('SELECT id, author_id, body, media_id FROM posts WHERE id = ?').get(id) as PostRow | undefined
    if (!post) throw notFound('That post')
    return post
  }

  // ---------- posts ----------

  router.get('/', (req, res) => {
    const q = pageQuery.parse(req.query)
    let authorId: number | undefined
    if (q.author) {
      const author = db.prepare('SELECT id FROM users WHERE username = ?').get(q.author) as { id: number } | undefined
      if (!author) throw notFound('That profile')
      authorId = author.id
    }
    res.json(listPosts(db, req.user!, { cursor: q.cursor, limit: q.limit, authorId }))
  })

  router.get('/:id', (req, res) => {
    const post = getPostView(db, req.user!, parseId(req.params.id))
    if (!post) throw notFound('That post')
    res.json({ post })
  })

  // multipart/form-data: "body" text and an optional "image" file
  router.post('/', singleImage('image'), (req, res) => {
    const me = req.user!
    const { body } = parse(postBodySchema, req.body ?? {})
    if (!body && !req.file) throw badRequest('Write something or add a photo.', { body: 'Write something or add a photo.' })
    const id = transaction(db, () => {
      const mediaId = req.file ? storeImage(db, me.id, req.file) : null
      const { lastInsertRowid } = db
        .prepare('INSERT INTO posts (author_id, body, media_id, created_at) VALUES (?, ?, ?, ?)')
        .run(me.id, body, mediaId, nowIso())
      return Number(lastInsertRowid)
    })
    res.status(201).json({ post: getPostView(db, me, id) })
  })

  router.patch('/:id', (req, res) => {
    const me = req.user!
    const post = getPost(parseId(req.params.id))
    if (!canEditPost(me, { authorId: post.author_id })) throw forbidden('You can only edit your own posts.')
    const input = parse(postEditSchema, req.body)
    const keepsImage = post.media_id !== null && !input.removeImage
    if (!input.body && !keepsImage) throw badRequest('A post needs text or a photo.', { body: 'A post needs text or a photo.' })
    transaction(db, () => {
      db.prepare('UPDATE posts SET body = ?, media_id = ?, edited_at = ? WHERE id = ?').run(
        input.body,
        keepsImage ? post.media_id : null,
        nowIso(),
        post.id,
      )
      if (input.removeImage) deleteMedia(db, post.media_id)
    })
    res.json({ post: getPostView(db, me, post.id) })
  })

  router.delete('/:id', (req, res) => {
    const me = req.user!
    const post = getPost(parseId(req.params.id))
    if (!canDeletePost(me, { authorId: post.author_id })) throw forbidden('You can only delete your own posts.')
    transaction(db, () => {
      db.prepare('DELETE FROM posts WHERE id = ?').run(post.id) // comments and reactions cascade
      deleteMedia(db, post.media_id)
    })
    res.status(204).end()
  })

  // ---------- reactions ----------

  router.put('/:id/reaction', (req, res) => {
    const me = req.user!
    const post = getPost(parseId(req.params.id))
    const { type } = parse(reactionSchema, req.body)
    db.prepare(
      `INSERT INTO reactions (post_id, user_id, type, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (post_id, user_id) DO UPDATE SET type = excluded.type`,
    ).run(post.id, me.id, type, nowIso())
    res.json({ post: getPostView(db, me, post.id) })
  })

  router.delete('/:id/reaction', (req, res) => {
    const me = req.user!
    const post = getPost(parseId(req.params.id))
    db.prepare('DELETE FROM reactions WHERE post_id = ? AND user_id = ?').run(post.id, me.id)
    res.json({ post: getPostView(db, me, post.id) })
  })

  // ---------- comments ----------

  router.get('/:id/comments', (req, res) => {
    const post = getPost(parseId(req.params.id))
    const q = pageQuery.parse(req.query)
    res.json(listComments(db, req.user!, post.id, { cursor: q.cursor, limit: q.limit }))
  })

  router.post('/:id/comments', (req, res) => {
    const me = req.user!
    const post = getPost(parseId(req.params.id))
    const { body } = parse(commentSchema, req.body)
    const { lastInsertRowid } = db
      .prepare('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?)')
      .run(post.id, me.id, body, nowIso())
    res.status(201).json({ comment: getCommentView(db, me, Number(lastInsertRowid)) })
  })

  return router
}

export function commentRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  const getComment = (raw: unknown) => {
    const comment = getCommentRecord(db, parseId(raw))
    if (!comment) throw notFound('That comment')
    return comment
  }

  router.patch('/:id', (req, res) => {
    const me = req.user!
    const comment = getComment(req.params.id)
    if (!canEditComment(me, { authorId: comment.author_id })) throw forbidden('You can only edit your own comments.')
    const { body } = parse(commentSchema, req.body)
    db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?').run(body, nowIso(), comment.id)
    res.json({ comment: getCommentView(db, me, comment.id) })
  })

  router.delete('/:id', (req, res) => {
    const me = req.user!
    const comment = getComment(req.params.id)
    if (!canDeleteComment(me, { authorId: comment.author_id }, { authorId: comment.post_author_id })) {
      throw forbidden('You can only delete your own comments, or comments on your own posts.')
    }
    db.prepare('DELETE FROM comments WHERE id = ?').run(comment.id)
    res.status(204).end()
  })

  return router
}
