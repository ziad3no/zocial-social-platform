/**
 * Demo community: eight fictional members, about forty posts over the last
 * three weeks (some with pictures), comments and reactions. A fixed random
 * seed gives the same data every time. Seeded accounts have no password;
 * the first three are reachable through "Try a demo account".
 */
import { REACTIONS } from '../shared/schemas'
import { NO_PASSWORD } from './auth'
import { SETUP_LOCK, type DB, type Queryable } from './db'
import { landscapePng } from './placeholder-images'

function mulberry32(seed: number) {
  return () => {
    seed |= 0
    seed = (seed + 0x6d2b79f5) | 0
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const PEOPLE = [
  { username: 'nour', displayName: 'Nour Hassan', bio: 'Second-year CS student. Building small web apps and learning in public.' },
  { username: 'adam_k', displayName: 'Adam Kamal', bio: 'Frontend intern. Coffee, CSS and long walks by the Nile.' },
  { username: 'mai_designs', displayName: 'Mai Samir', bio: 'UI/UX designer. I post sketches and the occasional rant about spacing.' },
  { username: 'omar_dev', displayName: 'Omar Fathy', bio: 'Backend developer. Databases are fun, I promise.' },
  { username: 'leila', displayName: 'Leila Mansour', bio: 'Business analyst in training. Asking “why” for a living.' },
  { username: 'yassin', displayName: 'Yassin Adel', bio: 'Photography on weekends.' },
  { username: 'hana_r', displayName: 'Hana Rashed', bio: '' },
  { username: 'karim', displayName: 'Karim Zaki', bio: 'Data science student. Charts > words.' },
]

const POSTS = [
  'Finally shipped my first full-stack project. It has bugs, but it’s live, and that counts.',
  'Hot take: writing the README first makes the code better.',
  'Anyone else spend 40 minutes on a bug that turned out to be a missing await?',
  'Sunset from the rooftop today.',
  'Reading list for this week: two articles on database indexes and one on writing clear error messages.',
  'Started a 30-day CSS challenge. Day 1: centring a div. Day 2: still centring a div.',
  'Our team retro today was the most useful meeting of the month. We changed one thing and it already helps.',
  'Quick tip: put your filters in the URL. Users can share the exact view and the back button just works.',
  'Morning walk before the deadline crunch.',
  'Does anyone have a good resource on accessibility testing with a screen reader?',
  'Pair programming session went way better than expected. Two heads, one keyboard.',
  'I redesigned my portfolio three times this month. Send help.',
  'The best bug reports have steps, expected result and actual result. That’s it.',
  'Weekend trip photos are finally sorted.',
  'Learning SQL joins with a pen and paper first. It helped more than any video.',
  'Mentor told me: “Ship small, ship often.” Writing it here so I remember.',
  'New desk setup. The plant is doing most of the work.',
  'Today I learned that SQLite can do row-value comparisons. Cursor pagination just got easier.',
  'If your form shows all errors only after submit, people give up. Validate on blur.',
  'Coffee count today: 3. Lines of working code: also 3.',
  'Spent the evening sketching app ideas. Most of them are bad, one might be good.',
  'Dark mode shipped. Contrast checked. Feeling responsible.',
  'Who’s going to the community meetup next week?',
  'The view from the train this morning.',
  'Tiny win: my tests finally run in under a second.',
  'Reminder that empty states are part of the design, not an afterthought.',
  'I wrote my first user story with acceptance criteria today. Given / When / Then is oddly satisfying.',
  'Rainy afternoon, good playlist, long to-do list.',
  'What’s one tool you wish you’d learned earlier?',
  'Golden hour by the river.',
  'Refactored a 300-line component into four small ones. Same behaviour, much easier to read.',
  'Just passed my first code review without changes requested.',
  'Notes from today’s workshop: talk to users, then write requirements, then build.',
  'Late night debugging session. The bug was a typo. It is always a typo.',
  'First time presenting a demo to the whole team. Nervous, but it went well.',
  'Sky looked unreal today.',
  'Small habit that helps: write tomorrow’s first task before closing the laptop.',
  'Our study group hit 20 members!',
]

const COMMENTS = [
  'Congrats! 🎉', 'This is so true.', 'Love this.', 'Same here, every single time.', 'Great tip, thanks for sharing.',
  'Beautiful shot!', 'Where was this taken?', 'Saving this for later.', 'Happened to me yesterday 😅', 'Couldn’t agree more.',
  'Can you share the resource?', 'Proud of you!', 'Adding this to my list.', 'Good luck!', 'This made my day.',
]

/** Posts with these indexes get a picture. */
const WITH_IMAGE = new Set([3, 8, 13, 16, 23, 29, 35])

/** One INSERT for many rows. Returns the generated ids in the same order. */
async function insertMany(t: Queryable, table: string, cols: string[], rows: unknown[][], returning = true): Promise<number[]> {
  if (!rows.length) return []
  const values = rows.map((r) => `(${r.map(() => '?').join(', ')})`).join(', ')
  const sql = `INSERT INTO ${table} (${cols.join(', ')}) VALUES ${values}${returning ? ' RETURNING id' : ' ON CONFLICT DO NOTHING'}`
  const out = await t.all<{ id: number }>(sql, rows.flat())
  return out.map((r) => r.id)
}

export async function seed(t: Queryable, now = new Date()) {
  const rand = mulberry32(42)
  const pick = <T>(list: readonly T[]) => list[Math.floor(rand() * list.length)]!

  const userIds = await insertMany(
    t,
    'users',
    ['username', 'display_name', 'bio', 'password_hash', 'is_demo', 'created_at'],
    PEOPLE.map((p, i) => [p.username, p.displayName, p.bio, NO_PASSWORD, true, new Date(now.getTime() - (60 + i * 5) * 86_400_000).toISOString()]),
  )

  // Work out every post, comment and reaction first, then write them in a few queries.
  const total = POSTS.length
  const posts: { authorId: number; body: string; image: number | null; created: Date; edited: string | null }[] = []
  const comments: { post: number; author: number; body: string; when: string }[] = []
  const reactions: { post: number; user: number; type: string; when: string }[] = []
  POSTS.forEach((body, i) => {
    const authorId = userIds[i % 3 === 0 ? 0 : Math.floor(rand() * userIds.length)]!
    const created = new Date(now.getTime() - ((total - i) * 13 + Math.floor(rand() * 8)) * 3_600_000)
    const edited = rand() < 0.1 ? new Date(created.getTime() + 20 * 60_000).toISOString() : null
    posts.push({ authorId, body, image: WITH_IMAGE.has(i) ? i : null, created, edited })
    const commentCount = Math.floor(rand() * rand() * 9)
    for (let c = 0; c < commentCount; c++) {
      const when = new Date(created.getTime() + (c + 1) * (15 + Math.floor(rand() * 90)) * 60_000)
      if (when > now) break
      comments.push({ post: i, author: pick(userIds), body: pick(COMMENTS), when: when.toISOString() })
    }
    for (const uid of userIds) {
      if (uid !== authorId && rand() < 0.45) {
        reactions.push({ post: i, user: uid, type: rand() < 0.6 ? 'like' : pick(REACTIONS), when: created.toISOString() })
      }
    }
  })

  const mediaIds = new Map<number, number>()
  for (const p of posts) {
    if (p.image === null) continue
    const png = landscapePng(p.image)
    const row = await t.get<{ id: number }>('INSERT INTO media (owner_id, mime, bytes, size, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id', [
      p.authorId,
      'image/png',
      png,
      png.length,
      p.created.toISOString(),
    ])
    mediaIds.set(p.image, row!.id)
  }

  const postIds = await insertMany(
    t,
    'posts',
    ['author_id', 'body', 'media_id', 'created_at', 'edited_at'],
    posts.map((p) => [p.authorId, p.body, p.image === null ? null : mediaIds.get(p.image)!, p.created.toISOString(), p.edited]),
  )
  await insertMany(t, 'comments', ['post_id', 'author_id', 'body', 'created_at'], comments.map((c) => [postIds[c.post], c.author, c.body, c.when]))
  await insertMany(t, 'reactions', ['post_id', 'user_id', 'type', 'created_at'], reactions.map((r) => [postIds[r.post], r.user, r.type, r.when]), false)
  await t.run(`INSERT INTO app_meta (key, value) VALUES ('seeded_at', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value`, [
    new Date().toISOString(),
  ])
}

const WIPE = 'TRUNCATE sessions, reactions, comments, posts, media, users, app_meta RESTART IDENTITY CASCADE'

/** Seed an empty database. Safe when several servers start at once. */
export async function ensureSeeded(db: DB) {
  await db.tx(async (t) => {
    await t.get('SELECT pg_advisory_xact_lock(?)', [SETUP_LOCK])
    const row = await t.get<{ n: number }>('SELECT COUNT(*)::int AS n FROM users')
    if ((row?.n ?? 0) === 0) await seed(t)
  })
}

/** Delete everything and seed again. */
export async function resetDemo(db: DB) {
  await db.tx(async (t) => {
    await t.get('SELECT pg_advisory_xact_lock(?)', [SETUP_LOCK])
    await t.exec(WIPE)
    await seed(t)
  })
}

/**
 * Reset the shared demo data once it is older than `hours`. Checked at most
 * every 5 minutes per server, so it works on serverless hosts without a timer.
 */
export function demoResetter(db: DB, hours: number) {
  let lastCheck = 0
  return async () => {
    if (hours <= 0 || Date.now() - lastCheck < 5 * 60_000) return
    lastCheck = Date.now()
    const maxAge = hours * 3_600_000
    const stale = (value?: string) => !value || Date.now() - new Date(value).getTime() > maxAge
    const meta = await db.get<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'seeded_at'`)
    if (!stale(meta?.value)) return
    await db.tx(async (t) => {
      await t.get('SELECT pg_advisory_xact_lock(?)', [SETUP_LOCK])
      const again = await t.get<{ value: string }>(`SELECT value FROM app_meta WHERE key = 'seeded_at'`)
      if (!stale(again?.value)) return
      await t.exec(WIPE)
      await seed(t)
    })
  }
}
