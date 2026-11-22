import type { InfiniteData, QueryClient } from '@tanstack/react-query'
import type { CursorPage, PostView } from '../shared/types'

/**
 * A post can be on screen in several lists at once (the feed, a profile, its
 * own page). These helpers update or remove it everywhere so every view agrees
 * without refetching.
 */
type Feed = InfiniteData<CursorPage<PostView>>

export function replacePost(qc: QueryClient, post: PostView) {
  qc.setQueriesData<Feed>({ queryKey: ['posts'] }, (data) =>
    data && { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === post.id ? post : x)) })) },
  )
  qc.setQueryData(['post', post.id], post)
}

export function updatePost(qc: QueryClient, id: number, change: (p: PostView) => PostView) {
  qc.setQueriesData<Feed>({ queryKey: ['posts'] }, (data) =>
    data && { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.map((x) => (x.id === id ? change(x) : x)) })) },
  )
  qc.setQueryData<PostView>(['post', id], (p) => p && change(p))
}

export function removePost(qc: QueryClient, id: number) {
  qc.setQueriesData<Feed>({ queryKey: ['posts'] }, (data) =>
    data && { ...data, pages: data.pages.map((p) => ({ ...p, items: p.items.filter((x) => x.id !== id) })) },
  )
  qc.removeQueries({ queryKey: ['post', id] })
}

/** Put a new post at the top of the feed (and the author's profile list). */
export function prependPost(qc: QueryClient, post: PostView) {
  for (const key of [['posts', 'feed'], ['posts', 'author', post.author.username]]) {
    qc.setQueryData<Feed>(key, (data) => {
      if (!data || !data.pages.length) return data
      const [first, ...rest] = data.pages
      return { ...data, pages: [{ ...first!, items: [post, ...first!.items] }, ...rest] }
    })
  }
}

/** Snapshot every cached copy of the post lists, to roll back a failed optimistic change. */
export function snapshot(qc: QueryClient) {
  const lists = qc.getQueriesData<Feed>({ queryKey: ['posts'] })
  const singles = qc.getQueriesData<PostView>({ queryKey: ['post'] })
  return () => {
    for (const [key, data] of lists) qc.setQueryData(key, data)
    for (const [key, data] of singles) qc.setQueryData(key, data)
  }
}
