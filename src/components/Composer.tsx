import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type FormEvent } from 'react'
import { POST_MAX } from '../../shared/schemas'
import type { PostView } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useUser } from '../auth'
import { ACCEPT_ATTR, prepareImage } from '../images'
import { prependPost } from '../posts-cache'
import { Icon } from './Icon'
import { Avatar, FormError, useToast } from './ui'

export function Composer() {
  const me = useUser()
  const qc = useQueryClient()
  const toast = useToast()
  const [body, setBody] = useState('')
  const [image, setImage] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview])

  async function pick(file: File | undefined) {
    if (!file) return
    setError(undefined)
    try {
      const blob = await prepareImage(file)
      setImage(blob)
      setPreview(URL.createObjectURL(blob))
    } catch (err) {
      setError((err as Error).message)
    } finally {
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  function clearImage() {
    setImage(null)
    setPreview(null)
  }

  async function submit(e: FormEvent) {
    e.preventDefault()
    setError(undefined)
    if (!body.trim() && !image) return setError('Write something or add a photo.')
    if (body.length > POST_MAX) return setError(`Posts can be up to ${POST_MAX} characters.`)
    const form = new FormData()
    form.set('body', body)
    if (image) form.set('image', image, image.type === 'image/gif' ? 'photo.gif' : 'photo.webp')
    setBusy(true)
    try {
      const { post } = await api<{ post: PostView }>('/posts', { method: 'POST', body: form })
      prependPost(qc, post)
      void qc.invalidateQueries({ queryKey: ['profile', me.username] })
      setBody('')
      clearImage()
      toast('ok', 'Posted')
    } catch (err) {
      setError(errorMessage(err))
    } finally {
      setBusy(false)
    }
  }

  const over = body.length > POST_MAX
  return (
    <form className="card composer" onSubmit={submit} noValidate aria-label="Create a post">
      <Avatar name={me.displayName} url={me.avatarUrl} size={42} />
      <div className="composer-main">
        <label htmlFor="composer-text" className="sr-only">
          What’s on your mind?
        </label>
        <textarea
          id="composer-text"
          className="input composer-text"
          placeholder={`What’s on your mind, ${me.displayName.split(' ')[0]}?`}
          rows={3}
          value={body}
          onChange={(e) => setBody(e.target.value)}
          aria-invalid={over}
        />
        {preview && (
          <div className="composer-preview">
            <img src={preview} alt="Selected photo" />
            <button type="button" className="icon-btn remove" onClick={clearImage} aria-label="Remove photo">
              <Icon name="close" size={16} />
            </button>
          </div>
        )}
        <FormError message={error} />
        <div className="composer-bar">
          <input ref={fileRef} type="file" accept={ACCEPT_ATTR} hidden id="composer-file" onChange={(e) => void pick(e.target.files?.[0])} />
          <button type="button" className="btn btn-ghost" onClick={() => fileRef.current?.click()}>
            <Icon name="image" size={18} /> Photo
          </button>
          <span className={`counter${over ? ' over' : ''}`} aria-live="polite">
            {body.length > 0 && `${body.length}/${POST_MAX}`}
          </span>
          <button type="submit" className="btn btn-primary" disabled={busy || over}>
            {busy ? 'Posting…' : 'Post'}
          </button>
        </div>
      </div>
    </form>
  )
}
