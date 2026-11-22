import type { Reaction } from './schemas'

export interface UserSummary {
  id: number
  username: string
  displayName: string
  avatarUrl: string | null
}

export interface SessionUser extends UserSummary {
  bio: string
  isDemo: boolean
}

export interface Profile extends UserSummary {
  bio: string
  joinedAt: string
  postCount: number
  reactionsReceived: number
}

export interface PostView {
  id: number
  author: UserSummary
  body: string
  imageUrl: string | null
  createdAt: string
  editedAt: string | null
  reactions: Record<Reaction, number>
  myReaction: Reaction | null
  commentCount: number
  canEdit: boolean
  canDelete: boolean
}

export interface CommentView {
  id: number
  postId: number
  author: UserSummary
  body: string
  createdAt: string
  editedAt: string | null
  canEdit: boolean
  canDelete: boolean
}

/** Cursor pages: pass nextCursor back to get the next slice; null means the end. */
export interface CursorPage<T> {
  items: T[]
  nextCursor: string | null
}

export interface AppConfig {
  demoLogin: boolean
  demoAccounts: UserSummary[]
}

export interface ApiErrorBody {
  error: { message: string; fieldErrors?: Record<string, string> }
}
