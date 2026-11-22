import { useInfiniteQuery, useMutation, useQueryClient, type InfiniteData } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { COMMENT_MAX } from '../../shared/schemas'
import type { CommentView, CursorPage, PostView } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useUser } from '../auth'
import { formatFull, shortTime } from '../format'
import { updatePost } from '../posts-cache'
import { Icon } from './Icon'
import { Avatar, ConfirmDialog, useToast } from './ui'

type Pages = InfiniteData<CursorPage<CommentView>>
const PAGE = 5

export function Comments({ post, id }: { post: PostView; id: string }) {
  const comments = useInfiniteQuery({
    queryKey: ['comments', post.id],
    queryFn: ({ pageParam }) =>
      api<CursorPage<CommentView>>(`/posts/${post.id}/comments`, { query: { limit: PAGE, cursor: pageParam } }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  })
  const items = comments.data?.pages.flatMap((p) => p.items) ?? []

  return (
    <section className="comments" id={id} aria-label="Comments">
      {comments.isPending ? (
        <div className="comment-skeleton" aria-busy="true">
          <span className="skeleton" style={{ width: '60%' }} />
          <span className="skeleton" style={{ width: '40%' }} />
        </div>
      ) : comments.isError ? (
        <div className="inline-error" role="alert">
          <Icon name="alert" size={16} /> Comments couldn’t load. {errorMessage(comments.error)}
          <button type="button" className="link-btn" onClick={() => void comments.refetch()}>
            Try again
          </button>
        </div>
      ) : items.length === 0 ? (
        <p className="muted small no-comments">No comments yet. Start the conversation.</p>
      ) : (
        <ul className="comment-list">
          {items.map((c) => (
            <CommentItem key={c.id} comment={c} post={post} />
          ))}
        </ul>
      )}
      {comments.hasNextPage && (
        <button type="button" className="link-btn more-comments" onClick={() => void comments.fetchNextPage()} disabled={comments.isFetchingNextPage}>
          {comments.isFetchingNextPage ? 'Loading…' : 'Show more comments'}
        </button>
      )}
      <CommentForm post={post} />
    </section>
  )
}

function CommentForm({ post }: { post: PostView }) {
  const me = useUser()
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [error, setError] = useState<string>()

  const add = useMutation({
    mutationFn: (text: string) => api<{ comment: CommentView }>(`/posts/${post.id}/comments`, { method: 'POST', body: { body: text } }),
    onSuccess: ({ comment }) => {
      setBody('')
      // Comments read oldest first, so a new one goes on the last loaded page,
      // unless older pages are still to load (then it will arrive with them).
      qc.setQueryData<Pages>(['comments', post.id], (data) => {
        if (!data) return data
        const last = data.pages.at(-1)!
        if (last.nextCursor) return data
        return { ...data, pages: [...data.pages.slice(0, -1), { ...last, items: [...last.items, comment] }] }
      })
      updatePost(qc, post.id, (p) => ({ ...p, commentCount: p.commentCount + 1 }))
    },
    onError: (err) => setError(errorMessage(err)),
  })

  function submit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    if (!body.trim()) return setError('Write a comment first.')
    if (body.length > COMMENT_MAX) return setError(`Comments can be up to ${COMMENT_MAX} characters.`)
    add.mutate(body)
  }

  return (
    <form className="comment-form" onSubmit={submit} noValidate>
      <Avatar name={me.displayName} url={me.avatarUrl} size={32} />
      <div className="comment-input">
        <label className="sr-only" htmlFor={`c-${post.id}`}>
          Write a comment
        </label>
        <textarea
          id={`c-${post.id}`}
          className="input"
          rows={1}
          placeholder="Write a comment…"
          value={body}
          aria-invalid={!!error}
          aria-describedby={error ? `c-${post.id}-err` : undefined}
          onChange={(e) => setBody(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
        />
        {error && (
          <p className="field-error" id={`c-${post.id}-err`} role="alert">
            <Icon name="alert" size={14} /> {error}
          </p>
        )}
        {body.length > COMMENT_MAX * 0.8 && <span className={`counter${body.length > COMMENT_MAX ? ' over' : ''}`}>{body.length}/{COMMENT_MAX}</span>}
      </div>
      <button type="submit" className="icon-btn send" aria-label="Post comment" disabled={add.isPending}>
        <Icon name="send" size={18} />
      </button>
    </form>
  )
}

function CommentItem({ comment, post }: { comment: CommentView; post: PostView }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(comment.body)
  const [error, setError] = useState<string>()
  const [deleting, setDeleting] = useState(false)

  const replaceInCache = (next: CommentView | null) =>
    qc.setQueryData<Pages>(['comments', post.id], (data) =>
      data && {
        ...data,
        pages: data.pages.map((p) => ({
          ...p,
          items: next ? p.items.map((c) => (c.id === next.id ? next : c)) : p.items.filter((c) => c.id !== comment.id),
        })),
      },
    )

  const save = useMutation({
    mutationFn: (text: string) => api<{ comment: CommentView }>(`/comments/${comment.id}`, { method: 'PATCH', body: { body: text } }),
    onSuccess: (res) => {
      replaceInCache(res.comment)
      setEditing(false)
    },
    onError: (err) => setError(errorMessage(err)),
  })

  const remove = useMutation({
    mutationFn: () => api(`/comments/${comment.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(false)
      replaceInCache(null)
      updatePost(qc, post.id, (p) => ({ ...p, commentCount: Math.max(0, p.commentCount - 1) }))
      toast('ok', 'Comment deleted')
    },
  })

  return (
    <li className="comment">
      <Link to={`/u/${comment.author.username}`} aria-hidden="true" tabIndex={-1}>
        <Avatar name={comment.author.displayName} url={comment.author.avatarUrl} size={32} />
      </Link>
      <div className="comment-main">
        <div className="bubble">
          <Link to={`/u/${comment.author.username}`} className="strong">
            {comment.author.displayName}
          </Link>
          {editing ? (
            <form
              onSubmit={(e) => {
                e.preventDefault()
                setError(undefined)
                if (!draft.trim()) return setError('A comment can’t be empty.')
                save.mutate(draft)
              }}
              className="comment-edit"
            >
              <label className="sr-only" htmlFor={`ce-${comment.id}`}>
                Edit comment
              </label>
              <textarea id={`ce-${comment.id}`} className="input" rows={2} value={draft} onChange={(e) => setDraft(e.target.value)} autoFocus />
              {error && (
                <p className="field-error" role="alert">
                  <Icon name="alert" size={14} /> {error}
                </p>
              )}
              <div className="row">
                <button type="submit" className="btn btn-sm btn-primary" disabled={save.isPending}>
                  Save
                </button>
                <button
                  type="button"
                  className="btn btn-sm"
                  onClick={() => {
                    setEditing(false)
                    setDraft(comment.body)
                    setError(undefined)
                  }}
                >
                  Cancel
                </button>
              </div>
            </form>
          ) : (
            <p className="comment-body">{comment.body}</p>
          )}
        </div>
        <div className="comment-meta">
          <time dateTime={comment.createdAt} title={formatFull(comment.createdAt)}>
            {shortTime(comment.createdAt)}
          </time>
          {comment.editedAt && <span>edited</span>}
          {comment.canEdit && !editing && (
            <button type="button" className="link-btn" onClick={() => setEditing(true)}>
              Edit
            </button>
          )}
          {comment.canDelete && (
            <button type="button" className="link-btn" onClick={() => (remove.reset(), setDeleting(true))}>
              Delete
            </button>
          )}
        </div>
      </div>
      <ConfirmDialog
        open={deleting}
        title="Delete comment?"
        message={
          comment.canEdit
            ? 'Your comment will be removed. This can’t be undone.'
            : `This removes ${comment.author.displayName}’s comment from your post. It can’t be undone.`
        }
        confirmLabel="Delete comment"
        busy={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </li>
  )
}
