import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Link } from 'react-router'
import { POST_MAX, REACTION_EMOJI, REACTION_LABEL, REACTIONS, type Reaction } from '../../shared/schemas'
import type { PostView } from '../../shared/types'
import { api, errorMessage } from '../api'
import { formatFull, plural, shortTime } from '../format'
import { removePost, replacePost, snapshot, updatePost } from '../posts-cache'
import { Comments } from './Comments'
import { Icon } from './Icon'
import { Avatar, ConfirmDialog, FormError, Modal, useToast } from './ui'

export function PostCard({ post, startOpen = false }: { post: PostView; startOpen?: boolean }) {
  const [showComments, setShowComments] = useState(startOpen)
  const [editing, setEditing] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const qc = useQueryClient()
  const toast = useToast()

  const remove = useMutation({
    mutationFn: () => api(`/posts/${post.id}`, { method: 'DELETE' }),
    onSuccess: () => {
      setDeleting(false)
      removePost(qc, post.id)
      void qc.invalidateQueries({ queryKey: ['profile'] })
      toast('ok', 'Post deleted')
    },
  })

  return (
    <article className="card post" aria-labelledby={`post-${post.id}-author`}>
      <header className="post-head">
        <Link to={`/u/${post.author.username}`} className="post-author" id={`post-${post.id}-author`}>
          <Avatar name={post.author.displayName} url={post.author.avatarUrl} size={42} />
          <span>
            <strong>{post.author.displayName}</strong>
            <span className="muted">@{post.author.username}</span>
          </span>
        </Link>
        <Link to={`/p/${post.id}`} className="post-time muted" title={formatFull(post.createdAt)}>
          <time dateTime={post.createdAt}>{shortTime(post.createdAt)}</time>
          {post.editedAt && <span title={`Edited ${formatFull(post.editedAt)}`}> · edited</span>}
        </Link>
        {(post.canEdit || post.canDelete) && (
          <PostMenu onEdit={() => setEditing(true)} onDelete={() => (remove.reset(), setDeleting(true))} />
        )}
      </header>

      {post.body && <p className="post-body">{post.body}</p>}
      {post.imageUrl && (
        <div className="post-media">
          <img src={post.imageUrl} alt={post.body ? '' : `Photo shared by ${post.author.displayName}`} loading="lazy" />
        </div>
      )}

      <ReactionBar post={post} />

      <div className="post-actions">
        <button
          type="button"
          className={`chip${showComments ? ' active' : ''}`}
          onClick={() => setShowComments((v) => !v)}
          aria-expanded={showComments}
          aria-controls={`comments-${post.id}`}
        >
          <Icon name="comment" size={16} />
          {post.commentCount === 0 ? 'Comment' : plural(post.commentCount, 'comment')}
        </button>
      </div>

      {showComments && <Comments post={post} id={`comments-${post.id}`} />}

      {editing && <EditPostDialog post={post} onClose={() => setEditing(false)} />}
      <ConfirmDialog
        open={deleting}
        title="Delete post?"
        message="This removes the post with its comments and reactions. It can’t be undone."
        confirmLabel="Delete post"
        busy={remove.isPending}
        error={remove.isError ? errorMessage(remove.error) : undefined}
        onConfirm={() => remove.mutate()}
        onClose={() => setDeleting(false)}
      />
    </article>
  )
}

function PostMenu({ onEdit, onDelete }: { onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent | KeyboardEvent) => {
      if (e instanceof KeyboardEvent ? e.key === 'Escape' : !ref.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', close)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', close)
    }
  }, [open])
  return (
    <div className="menu" ref={ref}>
      <button type="button" className="icon-btn" aria-label="Post options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <Icon name="more" />
      </button>
      {open && (
        <div className="menu-list" role="menu">
          <button type="button" role="menuitem" onClick={() => (setOpen(false), onEdit())}>
            <Icon name="edit" size={16} /> Edit post
          </button>
          <button type="button" role="menuitem" className="danger" onClick={() => (setOpen(false), onDelete())}>
            <Icon name="trash" size={16} /> Delete post
          </button>
        </div>
      )}
    </div>
  )
}

/**
 * One reaction per person. Clicking updates the counts at once (optimistic),
 * then replaces them with the server's numbers, or rolls back if the request fails.
 */
function ReactionBar({ post }: { post: PostView }) {
  const qc = useQueryClient()
  const toast = useToast()
  const total = REACTIONS.reduce((n, r) => n + post.reactions[r], 0)

  const react = useMutation({
    mutationFn: (next: Reaction | null) =>
      next
        ? api<{ post: PostView }>(`/posts/${post.id}/reaction`, { method: 'PUT', body: { type: next } })
        : api<{ post: PostView }>(`/posts/${post.id}/reaction`, { method: 'DELETE' }),
    onMutate: (next) => {
      const rollback = snapshot(qc)
      updatePost(qc, post.id, (p) => {
        const reactions = { ...p.reactions }
        if (p.myReaction) reactions[p.myReaction] = Math.max(0, reactions[p.myReaction] - 1)
        if (next) reactions[next] += 1
        return { ...p, reactions, myReaction: next }
      })
      return { rollback }
    },
    onSuccess: (res) => replacePost(qc, res.post),
    onError: (err, _next, ctx) => {
      ctx?.rollback()
      toast('error', `Your reaction wasn’t saved. ${errorMessage(err)}`)
    },
  })

  return (
    <div className="reactions" role="group" aria-label={`Reactions, ${plural(total, 'reaction')} in total`}>
      {REACTIONS.map((r) => {
        const mine = post.myReaction === r
        const count = post.reactions[r]
        return (
          <button
            key={r}
            type="button"
            className={`reaction${mine ? ' mine' : ''}${count === 0 ? ' zero' : ''}`}
            aria-pressed={mine}
            aria-label={`${REACTION_LABEL[r]}: ${count}${mine ? ', your reaction' : ''}`}
            title={mine ? `Remove your ${REACTION_LABEL[r]}` : REACTION_LABEL[r]}
            onClick={() => react.mutate(mine ? null : r)}
          >
            <span aria-hidden="true">{REACTION_EMOJI[r]}</span>
            {count > 0 && <span className="count">{count}</span>}
          </button>
        )
      })}
    </div>
  )
}

function EditPostDialog({ post, onClose }: { post: PostView; onClose: () => void }) {
  const qc = useQueryClient()
  const toast = useToast()
  const [body, setBody] = useState(post.body)
  const [removeImage, setRemoveImage] = useState(false)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const empty = !body.trim() && (!post.imageUrl || removeImage)

  async function save(e: FormEvent) {
    e.preventDefault()
    if (empty) return setError('A post needs text or a photo.')
    setBusy(true)
    setError(undefined)
    try {
      const res = await api<{ post: PostView }>(`/posts/${post.id}`, { method: 'PATCH', body: { body, removeImage } })
      replacePost(qc, res.post)
      toast('ok', 'Post updated')
      onClose()
    } catch (err) {
      setError(errorMessage(err))
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      title="Edit post"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form={`edit-${post.id}`} className="btn btn-primary" disabled={busy || body.length > POST_MAX}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <form id={`edit-${post.id}`} onSubmit={save} className="stack">
        <FormError message={error} />
        <label className="sr-only" htmlFor={`edit-body-${post.id}`}>
          Post text
        </label>
        <textarea
          id={`edit-body-${post.id}`}
          className="input"
          rows={5}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-describedby={`edit-count-${post.id}`}
        />
        <span id={`edit-count-${post.id}`} className={`counter${body.length > POST_MAX ? ' over' : ''}`}>
          {body.length}/{POST_MAX}
        </span>
        {post.imageUrl && (
          <label className={`edit-image${removeImage ? ' removed' : ''}`}>
            <img src={post.imageUrl} alt="" />
            <span>
              <input type="checkbox" checked={removeImage} onChange={(e) => setRemoveImage(e.target.checked)} /> Remove photo
            </span>
          </label>
        )}
      </form>
    </Modal>
  )
}
