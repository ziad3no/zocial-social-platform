import { useInfiniteQuery } from '@tanstack/react-query'
import { useEffect, useRef, type ReactNode } from 'react'
import type { CursorPage, PostView } from '../../shared/types'
import { api, errorMessage } from '../api'
import { PostCard } from './PostCard'
import { EmptyState, ErrorState } from './ui'

const PAGE = 10

/**
 * Cursor-paginated list of posts. The next page loads when the bottom comes
 * into view; a "Load more" button does the same for keyboard users and when
 * the observer isn't available.
 */
export function PostList({ author, empty }: { author?: string; empty: ReactNode }) {
  const posts = useInfiniteQuery({
    queryKey: author ? ['posts', 'author', author] : ['posts', 'feed'],
    queryFn: ({ pageParam }) => api<CursorPage<PostView>>('/posts', { query: { limit: PAGE, cursor: pageParam, author } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const sentinel = useRef<HTMLDivElement>(null)
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = posts

  useEffect(() => {
    const el = sentinel.current
    if (!el || !hasNextPage || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && !isFetchingNextPage) void fetchNextPage()
    }, { rootMargin: '400px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasNextPage, isFetchingNextPage, fetchNextPage])

  if (posts.isPending) return <PostSkeletons />
  if (posts.isError) return <ErrorState message={errorMessage(posts.error)} onRetry={() => void posts.refetch()} />

  const items = posts.data.pages.flatMap((p) => p.items)
  if (items.length === 0) return <>{empty}</>

  return (
    <div className="post-list">
      {items.map((p) => (
        <PostCard key={p.id} post={p} />
      ))}
      <div ref={sentinel} />
      {posts.isFetchNextPageError ? (
        <div className="list-end">
          <p className="muted">Couldn’t load more posts. Check your connection.</p>
          <button type="button" className="btn" onClick={() => void fetchNextPage()}>
            Try again
          </button>
        </div>
      ) : hasNextPage ? (
        <div className="list-end">
          <button type="button" className="btn" onClick={() => void fetchNextPage()} disabled={isFetchingNextPage}>
            {isFetchingNextPage ? 'Loading…' : 'Load more'}
          </button>
        </div>
      ) : (
        <p className="list-end muted">You’re all caught up.</p>
      )}
    </div>
  )
}

export function PostSkeletons({ count = 3 }: { count?: number }) {
  return (
    <div className="post-list" aria-busy="true" aria-label="Loading posts">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="card post">
          <div className="post-head">
            <span className="skeleton circle" />
            <span className="skeleton-lines">
              <span className="skeleton" style={{ width: 140 }} />
              <span className="skeleton" style={{ width: 90 }} />
            </span>
          </div>
          <span className="skeleton" style={{ width: '90%' }} />
          <span className="skeleton" style={{ width: '70%' }} />
          {i === 0 && <span className="skeleton block" />}
        </div>
      ))}
    </div>
  )
}

export const FeedEmpty = () => (
  <EmptyState icon="inbox" title="No posts yet">
    <p className="muted">Be the first to share something with the community.</p>
  </EmptyState>
)
