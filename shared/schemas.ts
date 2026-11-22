import { z } from 'zod'

export const REACTIONS = ['like', 'love', 'laugh', 'wow', 'sad'] as const
export type Reaction = (typeof REACTIONS)[number]
export const REACTION_EMOJI: Record<Reaction, string> = { like: '👍', love: '❤️', laugh: '😂', wow: '😮', sad: '😢' }
export const REACTION_LABEL: Record<Reaction, string> = { like: 'Like', love: 'Love', laugh: 'Haha', wow: 'Wow', sad: 'Sad' }

export const POST_MAX = 1000
export const COMMENT_MAX = 500
export const BIO_MAX = 160
export const IMAGE_MAX_BYTES = 3 * 1024 * 1024

export const username = z
  .string({ error: 'Choose a username' })
  .trim()
  .toLowerCase()
  .min(3, 'Username must be at least 3 characters')
  .max(20, 'Username must be 20 characters or fewer')
  .regex(/^[a-z0-9_]+$/, 'Use only letters, numbers and underscores')

const displayName = z
  .string({ error: 'Enter your name' })
  .trim()
  .min(2, 'Name must be at least 2 characters')
  .max(40, 'Name must be 40 characters or fewer')

const password = z
  .string({ error: 'Enter a password' })
  .min(8, 'Password must be at least 8 characters')
  .max(72, 'Password must be 72 characters or fewer')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number')

export const registerSchema = z.object({ username, displayName, password })
export const loginSchema = z.object({
  username: z.string({ error: 'Enter your username' }).trim().toLowerCase().min(1, 'Enter your username').max(40),
  password: z.string({ error: 'Enter your password' }).min(1, 'Enter your password').max(200),
})
export const demoLoginSchema = z.object({ username })

export const profileSchema = z.object({
  displayName,
  bio: z.string().trim().max(BIO_MAX, `Bio must be ${BIO_MAX} characters or fewer`).default(''),
})

/** Post text may be empty only when the post has an image; the route checks that. */
export const postBodySchema = z.object({
  body: z.string().trim().max(POST_MAX, `Posts can be up to ${POST_MAX} characters`).default(''),
})
export const postEditSchema = z.object({
  body: z.string().trim().max(POST_MAX, `Posts can be up to ${POST_MAX} characters`),
  removeImage: z.boolean().default(false),
})

export const commentSchema = z.object({
  body: z
    .string({ error: 'Write a comment' })
    .trim()
    .min(1, 'Write a comment first')
    .max(COMMENT_MAX, `Comments can be up to ${COMMENT_MAX} characters`),
})

export const reactionSchema = z.object({ type: z.enum(REACTIONS, { error: 'Unknown reaction' }) })

export const pageQuery = z.object({
  cursor: z.string().max(200).optional().catch(undefined),
  limit: z.coerce.number().int().min(1).max(30).catch(10),
  author: z.string().trim().toLowerCase().max(20).optional().catch(undefined),
})

export function fieldErrorsOf(error: z.ZodError): Record<string, string> {
  const out: Record<string, string> = {}
  for (const issue of error.issues) {
    const key = issue.path.join('.') || '_form'
    if (!(key in out)) out[key] = issue.message
  }
  return out
}
