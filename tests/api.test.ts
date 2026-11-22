import request from 'supertest'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { createApp } from '../server/app'
import { openDb, type DB } from '../server/db'
import { sniffImage } from '../server/media'
import { landscapePng } from '../server/placeholder-images'
import { resetDemo } from '../server/seed'

const H = { 'X-Requested-With': 'zocial' }

let db: DB
let app: ReturnType<typeof createApp>

// One in-memory Postgres (PGlite) for the file, wiped and re-seeded before each test.
beforeAll(async () => {
  db = await openDb()
}, 60_000)

afterAll(async () => {
  await db.close()
})

beforeEach(async () => {
  await resetDemo(db)
  app = createApp(db, { demoLogin: true, secureCookies: false })
})

async function as(username: string) {
  const agent = request.agent(app)
  await agent.post('/api/auth/demo').set(H).send({ username }).expect(200)
  return agent
}

async function newPost(agent: request.Agent, body = 'Hello from a test') {
  const res = await agent.post('/api/posts').set(H).field('body', body).expect(201)
  return res.body.post as { id: number; author: { username: string } }
}

describe('accounts', () => {
  it('registers, signs out and signs back in with the password', async () => {
    const agent = request.agent(app)
    const reg = await agent.post('/api/auth/register').set(H).send({ username: 'New_User', displayName: 'New User', password: 'secret123' })
    expect(reg.status).toBe(201)
    expect(reg.body.user.username).toBe('new_user')
    await agent.post('/api/auth/logout').set(H).expect(204)
    await agent.get('/api/posts').expect(401)
    await agent.post('/api/auth/login').set(H).send({ username: 'new_user', password: 'nope12345' }).expect(401)
    await agent.post('/api/auth/login').set(H).send({ username: 'NEW_USER', password: 'secret123' }).expect(200)
  })

  it('rejects a taken or badly formed username', async () => {
    const taken = await request(app).post('/api/auth/register').set(H).send({ username: 'nour', displayName: 'Copy', password: 'secret123' })
    expect(taken.status).toBe(409)
    const bad = await request(app).post('/api/auth/register').set(H).send({ username: 'a b', displayName: 'X', password: 'short' })
    expect(Object.keys(bad.body.error.fieldErrors).sort()).toEqual(['displayName', 'password', 'username'])
  })

  it('needs the CSRF header on writes', async () => {
    await request(app).post('/api/auth/demo').send({ username: 'nour' }).expect(403)
  })
})

describe('authorization: users cannot change other people’s content', () => {
  it('blocks editing or deleting someone else’s post', async () => {
    const nour = await as('nour')
    const adam = await as('adam_k')
    const post = await newPost(nour)
    const edit = await adam.patch(`/api/posts/${post.id}`).set(H).send({ body: 'hijacked' })
    expect(edit.status).toBe(403)
    expect(edit.body.error.message).toBe('You can only edit your own posts.')
    await adam.delete(`/api/posts/${post.id}`).set(H).expect(403)
    const still = await nour.get(`/api/posts/${post.id}`).expect(200)
    expect(still.body.post.body).toBe('Hello from a test')
  })

  it('reports canEdit / canDelete per viewer', async () => {
    const nour = await as('nour')
    const adam = await as('adam_k')
    const post = await newPost(nour)
    expect((await nour.get(`/api/posts/${post.id}`)).body.post).toMatchObject({ canEdit: true, canDelete: true })
    expect((await adam.get(`/api/posts/${post.id}`)).body.post).toMatchObject({ canEdit: false, canDelete: false })
  })

  it('lets only the author edit a comment, and the author or post owner delete it', async () => {
    const nour = await as('nour')
    const adam = await as('adam_k')
    const mai = await as('mai_designs')
    const post = await newPost(nour)
    const c1 = (await adam.post(`/api/posts/${post.id}/comments`).set(H).send({ body: 'First!' }).expect(201)).body.comment
    expect(c1).toMatchObject({ canEdit: true, canDelete: true })

    await nour.patch(`/api/comments/${c1.id}`).set(H).send({ body: 'edited by post owner' }).expect(403)
    await mai.delete(`/api/comments/${c1.id}`).set(H).expect(403)
    await adam.patch(`/api/comments/${c1.id}`).set(H).send({ body: 'First! (edited)' }).expect(200)

    const asOwner = (await nour.get(`/api/posts/${post.id}/comments`)).body.items[0]
    expect(asOwner).toMatchObject({ canEdit: false, canDelete: true, body: 'First! (edited)' })
    await nour.delete(`/api/comments/${c1.id}`).set(H).expect(204)
  })
})

describe('posts', () => {
  it('needs text or an image, and caps the length', async () => {
    const nour = await as('nour')
    const empty = await nour.post('/api/posts').set(H).field('body', '   ')
    expect(empty.status).toBe(400)
    expect(empty.body.error.fieldErrors.body).toBe('Write something or add a photo.')
    const long = await nour.post('/api/posts').set(H).field('body', 'x'.repeat(1001))
    expect(long.body.error.fieldErrors.body).toMatch(/up to 1000/)
  })

  it('accepts a real image and serves it back with the right type', async () => {
    const nour = await as('nour')
    const res = await nour.post('/api/posts').set(H).field('body', '').attach('image', landscapePng(1, 64, 40), 'pic.png').expect(201)
    const img = await nour.get(res.body.post.imageUrl).expect(200)
    expect(img.headers['content-type']).toBe('image/png')
  })

  it('rejects a file that only pretends to be an image', async () => {
    const nour = await as('nour')
    const fake = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
    const res = await nour.post('/api/posts').set(H).field('body', 'hi').attach('image', fake, { filename: 'x.png', contentType: 'image/png' })
    expect(res.status).toBe(400)
    expect(res.body.error.fieldErrors.image).toMatch(/JPG, PNG, WebP or GIF/)
  })

  it('edits, removes the image, and deletes with comments and reactions', async () => {
    const nour = await as('nour')
    const created = (await nour.post('/api/posts').set(H).field('body', 'with pic').attach('image', landscapePng(2, 64, 40), 'a.png')).body.post
    const edited = await nour.patch(`/api/posts/${created.id}`).set(H).send({ body: 'no pic now', removeImage: true }).expect(200)
    expect(edited.body.post).toMatchObject({ body: 'no pic now', imageUrl: null })
    expect(edited.body.post.editedAt).not.toBeNull()
    await nour.get(created.imageUrl).expect(404)

    await nour.put(`/api/posts/${created.id}/reaction`).set(H).send({ type: 'love' }).expect(200)
    await nour.post(`/api/posts/${created.id}/comments`).set(H).send({ body: 'note to self' }).expect(201)
    await nour.delete(`/api/posts/${created.id}`).set(H).expect(204)
    expect((await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM comments WHERE post_id = ?', [created.id]))?.n).toBe(0)
    expect((await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM reactions WHERE post_id = ?', [created.id]))?.n).toBe(0)
  })
})

describe('reactions', () => {
  it('keeps one reaction per user, which can be changed or removed', async () => {
    const adam = await as('adam_k')
    const post = (await adam.get('/api/posts?limit=1')).body.items[0]
    const before = post.reactions.wow
    const r1 = (await adam.put(`/api/posts/${post.id}/reaction`).set(H).send({ type: 'wow' })).body.post
    expect(r1.myReaction).toBe('wow')
    const r2 = (await adam.put(`/api/posts/${post.id}/reaction`).set(H).send({ type: 'laugh' })).body.post
    expect(r2.myReaction).toBe('laugh')
    expect(r2.reactions.wow).toBe(post.myReaction === 'wow' ? before - 1 : before)
    const r3 = (await adam.delete(`/api/posts/${post.id}/reaction`).set(H)).body.post
    expect(r3.myReaction).toBeNull()
    await adam.put(`/api/posts/${post.id}/reaction`).set(H).send({ type: 'angry' }).expect(400)
  })
})

describe('pagination', () => {
  it('walks the whole feed with cursors, newest first, without repeats', async () => {
    const adam = await as('adam_k')
    const seen: number[] = []
    let cursor: string | null = null
    let pages = 0
    do {
      const res: request.Response = await adam.get('/api/posts').query({ limit: 10, ...(cursor ? { cursor } : {}) }).expect(200)
      seen.push(...res.body.items.map((p: { id: number }) => p.id))
      cursor = res.body.nextCursor
      pages++
    } while (cursor && pages < 20)
    expect(pages).toBe(4)
    expect(new Set(seen).size).toBe(seen.length)
    expect(seen.length).toBe((await db.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM posts'))?.n)
    expect([...seen].sort((a, b) => b - a)).toEqual(seen)
  })

  it('does not shift pages when a new post arrives', async () => {
    const adam = await as('adam_k')
    const first = (await adam.get('/api/posts?limit=5')).body
    await newPost(adam, 'brand new')
    const second = (await adam.get('/api/posts').query({ limit: 5, cursor: first.nextCursor })).body
    expect(second.items[0].id).toBeLessThan(first.items.at(-1).id)
  })

  it('filters by author and pages comments oldest first', async () => {
    const adam = await as('adam_k')
    const mine = (await adam.get('/api/posts?author=nour&limit=30')).body.items
    expect(mine.length).toBeGreaterThan(0)
    expect(mine.every((p: { author: { username: string } }) => p.author.username === 'nour')).toBe(true)
    await adam.get('/api/posts?author=nobody_here').expect(404)

    const post = await newPost(adam)
    for (let i = 1; i <= 7; i++) await adam.post(`/api/posts/${post.id}/comments`).set(H).send({ body: `c${i}` })
    const p1 = (await adam.get(`/api/posts/${post.id}/comments?limit=5`)).body
    const p2 = (await adam.get(`/api/posts/${post.id}/comments`).query({ limit: 5, cursor: p1.nextCursor })).body
    expect([...p1.items, ...p2.items].map((c: { body: string }) => c.body)).toEqual(['c1', 'c2', 'c3', 'c4', 'c5', 'c6', 'c7'])
    expect(p2.nextCursor).toBeNull()
  })

  it('treats a garbage cursor as the first page', async () => {
    const adam = await as('adam_k')
    const res = await adam.get('/api/posts?cursor=not-a-cursor&limit=3').expect(200)
    expect(res.body.items).toHaveLength(3)
  })
})

describe('profiles', () => {
  it('shows a profile with counts and lets you edit only your own', async () => {
    const nour = await as('nour')
    const profile = (await nour.get('/api/users/nour').expect(200)).body.profile
    expect(profile.postCount).toBeGreaterThan(0)
    const res = await nour.patch('/api/me').set(H).send({ displayName: 'Nour H.', bio: 'Updated bio' }).expect(200)
    expect(res.body.user).toMatchObject({ displayName: 'Nour H.', bio: 'Updated bio' })
    await nour.get('/api/users/no_such_person').expect(404)
  })

  it('uploads and removes an avatar', async () => {
    const nour = await as('nour')
    const up = await nour.put('/api/me/avatar').set(H).attach('image', landscapePng(3, 40, 40), 'me.png').expect(200)
    expect(up.body.user.avatarUrl).toMatch(/^\/api\/media\/\d+$/)
    const down = await nour.delete('/api/me/avatar').set(H).expect(200)
    expect(down.body.user.avatarUrl).toBeNull()
  })
})

describe('sniffImage', () => {
  it('recognises real formats by their bytes', () => {
    expect(sniffImage(landscapePng(0, 8, 8))).toBe('image/png')
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg')
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 '))).toBe('image/webp')
    expect(sniffImage(Buffer.from('<?xml version="1.0"?><svg/>'))).toBeNull()
  })
})
