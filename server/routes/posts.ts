import { Router } from 'express'
import { canDeleteComment, canDeletePost, canEditComment, canEditPost } from '../../shared/rules'
import { commentSchema, pageQuery, postBodySchema, postEditSchema, reactionSchema } from '../../shared/schemas'
import { requireAuth } from '../auth'
import { nowIso, type DB } from '../db'
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

  const getPost = async (id: number) => {
    const post = await db.get<PostRow>('SELECT id, author_id, body, media_id FROM posts WHERE id = ?', [id])
    if (!post) throw notFound('That post')
    return post
  }

  // ---------- posts ----------

  router.get('/', async (req, res) => {
    const q = pageQuery.parse(req.query)
    let authorId: number | undefined
    if (q.author) {
      const author = await db.get<{ id: number }>('SELECT id FROM users WHERE username = ?', [q.author])
      if (!author) throw notFound('That profile')
      authorId = author.id
    }
    res.json(await listPosts(db, req.user!, { cursor: q.cursor, limit: q.limit, authorId }))
  })

  router.get('/:id', async (req, res) => {
    const post = await getPostView(db, req.user!, parseId(req.params.id))
    if (!post) throw notFound('That post')
    res.json({ post })
  })

  // multipart/form-data: "body" text and an optional "image" file
  router.post('/', singleImage('image'), async (req, res) => {
    const me = req.user!
    const { body } = parse(postBodySchema, req.body ?? {})
    if (!body && !req.file) throw badRequest('Write something or add a photo.', { body: 'Write something or add a photo.' })
    const id = await db.tx(async (t) => {
      const mediaId = req.file ? await storeImage(t, me.id, req.file) : null
      const row = await t.get<{ id: number }>('INSERT INTO posts (author_id, body, media_id, created_at) VALUES (?, ?, ?, ?) RETURNING id', [
        me.id,
        body,
        mediaId,
        nowIso(),
      ])
      return row!.id
    })
    res.status(201).json({ post: await getPostView(db, me, id) })
  })

  router.patch('/:id', async (req, res) => {
    const me = req.user!
    const post = await getPost(parseId(req.params.id))
    if (!canEditPost(me, { authorId: post.author_id })) throw forbidden('You can only edit your own posts.')
    const input = parse(postEditSchema, req.body)
    const keepsImage = post.media_id !== null && !input.removeImage
    if (!input.body && !keepsImage) throw badRequest('A post needs text or a photo.', { body: 'A post needs text or a photo.' })
    await db.tx(async (t) => {
      await t.run('UPDATE posts SET body = ?, media_id = ?, edited_at = ? WHERE id = ?', [
        input.body,
        keepsImage ? post.media_id : null,
        nowIso(),
        post.id,
      ])
      if (input.removeImage) await deleteMedia(t, post.media_id)
    })
    res.json({ post: await getPostView(db, me, post.id) })
  })

  router.delete('/:id', async (req, res) => {
    const me = req.user!
    const post = await getPost(parseId(req.params.id))
    if (!canDeletePost(me, { authorId: post.author_id })) throw forbidden('You can only delete your own posts.')
    await db.tx(async (t) => {
      await t.run('DELETE FROM posts WHERE id = ?', [post.id]) // comments and reactions cascade
      await deleteMedia(t, post.media_id)
    })
    res.status(204).end()
  })

  // ---------- reactions ----------

  router.put('/:id/reaction', async (req, res) => {
    const me = req.user!
    const post = await getPost(parseId(req.params.id))
    const { type } = parse(reactionSchema, req.body)
    await db.run(
      `INSERT INTO reactions (post_id, user_id, type, created_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (post_id, user_id) DO UPDATE SET type = excluded.type`,
      [post.id, me.id, type, nowIso()],
    )
    res.json({ post: await getPostView(db, me, post.id) })
  })

  router.delete('/:id/reaction', async (req, res) => {
    const me = req.user!
    const post = await getPost(parseId(req.params.id))
    await db.run('DELETE FROM reactions WHERE post_id = ? AND user_id = ?', [post.id, me.id])
    res.json({ post: await getPostView(db, me, post.id) })
  })

  // ---------- comments ----------

  router.get('/:id/comments', async (req, res) => {
    const post = await getPost(parseId(req.params.id))
    const q = pageQuery.parse(req.query)
    res.json(await listComments(db, req.user!, post.id, { cursor: q.cursor, limit: q.limit }))
  })

  router.post('/:id/comments', async (req, res) => {
    const me = req.user!
    const post = await getPost(parseId(req.params.id))
    const { body } = parse(commentSchema, req.body)
    const row = await db.get<{ id: number }>('INSERT INTO comments (post_id, author_id, body, created_at) VALUES (?, ?, ?, ?) RETURNING id', [
      post.id,
      me.id,
      body,
      nowIso(),
    ])
    res.status(201).json({ comment: await getCommentView(db, me, row!.id) })
  })

  return router
}

export function commentRoutes(db: DB) {
  const router = Router()
  router.use(requireAuth)

  const getComment = async (raw: unknown) => {
    const comment = await getCommentRecord(db, parseId(raw))
    if (!comment) throw notFound('That comment')
    return comment
  }

  router.patch('/:id', async (req, res) => {
    const me = req.user!
    const comment = await getComment(req.params.id)
    if (!canEditComment(me, { authorId: comment.author_id })) throw forbidden('You can only edit your own comments.')
    const { body } = parse(commentSchema, req.body)
    await db.run('UPDATE comments SET body = ?, edited_at = ? WHERE id = ?', [body, nowIso(), comment.id])
    res.json({ comment: await getCommentView(db, me, comment.id) })
  })

  router.delete('/:id', async (req, res) => {
    const me = req.user!
    const comment = await getComment(req.params.id)
    if (!canDeleteComment(me, { authorId: comment.author_id }, { authorId: comment.post_author_id })) {
      throw forbidden('You can only delete your own comments, or comments on your own posts.')
    }
    await db.run('DELETE FROM comments WHERE id = ?', [comment.id])
    res.status(204).end()
  })

  return router
}
