import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent, type ReactNode } from 'react'
import { Link, useLocation, useNavigate } from 'react-router'
import { loginSchema, registerSchema } from '../../shared/schemas'
import type { AppConfig, SessionUser } from '../../shared/types'
import { api, errorMessage } from '../api'
import { useAuth } from '../auth'
import { Icon } from '../components/Icon'
import { Avatar, FormError, TextInput } from '../components/ui'
import { useZodForm } from '../form'

function AuthShell({ title, subtitle, children }: { title: string; subtitle: string; children: ReactNode }) {
  return (
    <div className="auth">
      <div className="auth-intro">
        <div className="brand brand-lg">
          <span className="brand-mark" aria-hidden="true" />
          <span className="brand-name">Zocial</span>
        </div>
        <p>A small, friendly place for a community to share posts, photos and conversations.</p>
      </div>
      <div className="card auth-card">
        <h1>{title}</h1>
        <p className="muted">{subtitle}</p>
        {children}
      </div>
    </div>
  )
}

export function LoginPage() {
  const { signedIn } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const state = location.state as { notice?: string; from?: string } | null
  const form = useZodForm(loginSchema, { username: '', password: '' })
  const config = useQuery({ queryKey: ['config'], queryFn: () => api<AppConfig>('/config'), staleTime: Infinity })
  const [demoBusy, setDemoBusy] = useState<string | null>(null)
  const [demoError, setDemoError] = useState<string>()

  const finish = (user: SessionUser) => {
    signedIn(user)
    navigate(state?.from ?? '/', { replace: true })
  }

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void form.submit(async (data) => finish((await api<{ user: SessionUser }>('/auth/login', { method: 'POST', body: data })).user))
  }

  async function demo(username: string) {
    setDemoBusy(username)
    setDemoError(undefined)
    try {
      finish((await api<{ user: SessionUser }>('/auth/demo', { method: 'POST', body: { username } })).user)
    } catch (err) {
      setDemoError(errorMessage(err))
      setDemoBusy(null)
    }
  }

  return (
    <AuthShell title="Sign in" subtitle="Welcome back.">
      {state?.notice && <div className="banner banner-info">{state.notice}</div>}
      <form onSubmit={onSubmit} noValidate className="stack">
        <FormError message={form.formError} />
        <TextInput label="Username" autoComplete="username" required {...form.field('username')} />
        <TextInput label="Password" type="password" autoComplete="current-password" required {...form.field('password')} />
        <button type="submit" className="btn btn-primary btn-block" disabled={form.submitting}>
          {form.submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="center muted">
        New here? <Link to="/register">Create an account</Link>
      </p>
      {config.data?.demoLogin && config.data.demoAccounts.length > 0 && (
        <section className="demo-box" aria-labelledby="demo-title">
          <h2 id="demo-title">Try a demo account</h2>
          <p className="muted small">Sign in as one of these members with one click. Try two of them to see who can edit what.</p>
          <FormError message={demoError} />
          <div className="demo-list">
            {config.data.demoAccounts.map((u) => (
              <button key={u.id} type="button" className="demo-user" onClick={() => void demo(u.username)} disabled={demoBusy !== null}>
                <Avatar name={u.displayName} url={u.avatarUrl} size={36} />
                <span>
                  <strong>{demoBusy === u.username ? 'Signing in…' : u.displayName}</strong>
                  <span className="muted">@{u.username}</span>
                </span>
                <Icon name="arrowLeft" size={16} className="flip" />
              </button>
            ))}
          </div>
        </section>
      )}
    </AuthShell>
  )
}

export function RegisterPage() {
  const { signedIn } = useAuth()
  const navigate = useNavigate()
  const form = useZodForm(registerSchema, { username: '', displayName: '', password: '' })

  const onSubmit = (e: FormEvent) => {
    e.preventDefault()
    void form.submit(async (data) => {
      signedIn((await api<{ user: SessionUser }>('/auth/register', { method: 'POST', body: data })).user)
      navigate('/', { replace: true })
    })
  }

  return (
    <AuthShell title="Create an account" subtitle="Pick a username. You can add a photo and bio later.">
      <form onSubmit={onSubmit} noValidate className="stack">
        <FormError message={form.formError} />
        <TextInput label="Name" autoComplete="name" required {...form.field('displayName')} />
        <TextInput label="Username" autoComplete="username" required hint="3–20 letters, numbers or underscores." {...form.field('username')} />
        <TextInput
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint="At least 8 characters, with a letter and a number."
          {...form.field('password')}
        />
        <button type="submit" className="btn btn-primary btn-block" disabled={form.submitting}>
          {form.submitting ? 'Creating account…' : 'Create account'}
        </button>
      </form>
      <p className="center muted">
        Already a member? <Link to="/login">Sign in</Link>
      </p>
    </AuthShell>
  )
}
