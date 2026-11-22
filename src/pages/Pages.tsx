import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useRef, useState, type FormEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router'
import { BIO_MAX, profileSchema } from '../../shared/schemas'
import type { PostView, Profile, SessionUser } from '../../shared/types'
import { api, ApiError, errorMessage } from '../api'
import { useAuth, useUser } from '../auth'
import { Composer } from '../components/Composer'
import { Icon } from '../components/Icon'
import { PostCard } from '../components/PostCard'
import { FeedEmpty, PostList, PostSkeletons } from '../components/PostList'
import { Avatar, EmptyState, ErrorState, FormError, Modal, TextArea, TextInput, useToast } from '../components/ui'
import { useZodForm } from '../form'
import { ACCEPT_ATTR, prepareImage } from '../images'
import { formatMonth } from '../format'

export function FeedPage() {
  return (
    <>
      <h1 className="sr-only">Feed</h1>
      <Composer />
      <PostList empty={<FeedEmpty />} />
    </>
  )
}

export function ProfilePage() {
  const { username = '' } = useParams()
  const me = useUser()
  const [editing, setEditing] = useState(false)
  const profile = useQuery({
    queryKey: ['profile', username.toLowerCase()],
    queryFn: () => api<{ profile: Profile }>(`/users/${encodeURIComponent(username)}`).then((r) => r.profile),
  })
  const isMe = profile.data?.id === me.id

  if (profile.isPending) {
    return (
      <div className="card profile-head" aria-busy="true">
        <span className="skeleton circle big" />
        <span className="skeleton" style={{ width: 180, height: 18 }} />
      </div>
    )
  }
  if (profile.isError) {
    if (profile.error instanceof ApiError && profile.error.status === 404) {
      return (
        <EmptyState icon="user" title="This profile doesn’t exist">
          <p className="muted">There’s no one called @{username}. The account may have been renamed.</p>
          <Link to="/" className="btn">
            Back to the feed
          </Link>
        </EmptyState>
      )
    }
    return <ErrorState message={errorMessage(profile.error)} onRetry={() => void profile.refetch()} />
  }

  const p = profile.data
  return (
    <>
      <section className="card profile-head">
        <Avatar name={p.displayName} url={p.avatarUrl} size={96} />
        <div className="profile-text">
          <h1>{p.displayName}</h1>
          <p className="muted">@{p.username}</p>
          {p.bio ? <p className="bio">{p.bio}</p> : isMe ? <p className="muted bio">Add a short bio so people know who you are.</p> : null}
          <p className="profile-stats muted">
            <span>
              <strong>{p.postCount}</strong> {p.postCount === 1 ? 'post' : 'posts'}
            </span>
            <span>
              <strong>{p.reactionsReceived}</strong> reactions received
            </span>
            <span>
              <Icon name="calendar" size={14} /> Joined {formatMonth(p.joinedAt)}
            </span>
          </p>
        </div>
        {isMe && (
          <button type="button" className="btn profile-edit" onClick={() => setEditing(true)}>
            <Icon name="edit" size={16} /> Edit profile
          </button>
        )}
      </section>
      {isMe && <Composer />}
      <PostList
        author={p.username}
        empty={
          <EmptyState icon="inbox" title={isMe ? 'You haven’t posted yet' : `${p.displayName} hasn’t posted yet`}>
            {isMe && <p className="muted">Write your first post above.</p>}
          </EmptyState>
        }
      />
      {editing && <EditProfileDialog onClose={() => setEditing(false)} />}
    </>
  )
}

function EditProfileDialog({ onClose }: { onClose: () => void }) {
  const me = useUser()
  const { updateUser } = useAuth()
  const qc = useQueryClient()
  const toast = useToast()
  const form = useZodForm(profileSchema, { displayName: me.displayName, bio: me.bio })
  const [avatarError, setAvatarError] = useState<string>()
  const [avatarBusy, setAvatarBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  const refresh = (user: SessionUser) => {
    updateUser(user)
    void qc.invalidateQueries({ queryKey: ['profile'] })
    void qc.invalidateQueries({ queryKey: ['posts'] })
    void qc.invalidateQueries({ queryKey: ['comments'] })
  }

  async function uploadAvatar(file: File | undefined) {
    if (!file) return
    setAvatarError(undefined)
    setAvatarBusy(true)
    try {
      const blob = await prepareImage(file, 400)
      const body = new FormData()
      body.set('image', blob, 'avatar.webp')
      refresh((await api<{ user: SessionUser }>('/me/avatar', { method: 'PUT', body })).user)
    } catch (err) {
      setAvatarError(err instanceof ApiError ? (err.fieldErrors.image ?? err.message) : (err as Error).message)
    } finally {
      setAvatarBusy(false)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  async function removeAvatar() {
    setAvatarBusy(true)
    try {
      refresh((await api<{ user: SessionUser }>('/me/avatar', { method: 'DELETE' })).user)
    } catch (err) {
      setAvatarError(errorMessage(err))
    } finally {
      setAvatarBusy(false)
    }
  }

  const save = (e: FormEvent) => {
    e.preventDefault()
    void form.submit(async (data) => {
      refresh((await api<{ user: SessionUser }>('/me', { method: 'PATCH', body: data })).user)
      toast('ok', 'Profile saved')
      onClose()
    })
  }

  return (
    <Modal
      open
      title="Edit profile"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" form="profile-form" className="btn btn-primary" disabled={form.submitting}>
            {form.submitting ? 'Saving…' : 'Save'}
          </button>
        </>
      }
    >
      <div className="avatar-edit">
        <Avatar name={me.displayName} url={me.avatarUrl} size={72} />
        <div className="stack-sm">
          <input ref={fileRef} type="file" accept={ACCEPT_ATTR} hidden onChange={(e) => void uploadAvatar(e.target.files?.[0])} />
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()} disabled={avatarBusy}>
              <Icon name="image" size={16} /> {avatarBusy ? 'Uploading…' : me.avatarUrl ? 'Change photo' : 'Upload photo'}
            </button>
            {me.avatarUrl && (
              <button type="button" className="btn btn-sm btn-ghost" onClick={() => void removeAvatar()} disabled={avatarBusy}>
                Remove
              </button>
            )}
          </div>
          <span className="muted small">JPG, PNG, WebP or GIF. Without a photo, your initials are shown.</span>
          {avatarError && (
            <p className="field-error" role="alert">
              <Icon name="alert" size={14} /> {avatarError}
            </p>
          )}
        </div>
      </div>
      <form id="profile-form" onSubmit={save} noValidate className="stack">
        <FormError message={form.formError} />
        <TextInput label="Name" required maxLength={40} {...form.field('displayName')} />
        <TextArea label="Bio" rows={3} maxLength={BIO_MAX} hint={`${form.values.bio?.length ?? 0}/${BIO_MAX}`} {...form.field('bio')} />
      </form>
    </Modal>
  )
}

export function PostPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const post = useQuery({
    queryKey: ['post', Number(id)],
    queryFn: () => api<{ post: PostView }>(`/posts/${Number(id)}`).then((r) => r.post),
  })
  return (
    <>
      <button type="button" className="btn btn-ghost back" onClick={() => (history.length > 1 ? navigate(-1) : navigate('/'))}>
        <Icon name="arrowLeft" size={16} /> Back
      </button>
      {post.isPending ? (
        <PostSkeletons count={1} />
      ) : post.isError ? (
        post.error instanceof ApiError && post.error.status === 404 ? (
          <EmptyState icon="inbox" title="This post isn’t available">
            <p className="muted">It may have been deleted by its author.</p>
            <Link to="/" className="btn">
              Back to the feed
            </Link>
          </EmptyState>
        ) : (
          <ErrorState message={errorMessage(post.error)} onRetry={() => void post.refetch()} />
        )
      ) : (
        <PostCard post={post.data} startOpen />
      )}
    </>
  )
}

export function NotFoundPage() {
  return (
    <EmptyState icon="inbox" title="Page not found">
      <p className="muted">The link may be broken or the page may have moved.</p>
      <Link to="/" className="btn">
        Back to the feed
      </Link>
    </EmptyState>
  )
}

