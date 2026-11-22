import { useQuery, useQueryClient } from '@tanstack/react-query'
import { createContext, useCallback, useContext, useEffect, useMemo, type ReactNode } from 'react'
import { useNavigate } from 'react-router'
import type { SessionUser } from '../shared/types'
import { api, ApiError, onUnauthorized } from './api'

interface AuthValue {
  user: SessionUser | null
  loading: boolean
  /** Store the user returned by login/register/demo and go to the app. */
  signedIn: (user: SessionUser) => void
  signOut: () => Promise<void>
  updateUser: (user: SessionUser) => void
}

const AuthContext = createContext<AuthValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()

  const me = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return (await api<{ user: SessionUser }>('/auth/me')).user
      } catch (err) {
        if (err instanceof ApiError && err.status === 401) return null
        throw err
      }
    },
    staleTime: Infinity,
    retry: false,
  })

  // Session expired or account suspended mid-use: clear everything and go to sign-in.
  useEffect(
    () =>
      onUnauthorized(() => {
        queryClient.clear()
        queryClient.setQueryData(['me'], null)
        navigate('/login', { replace: true, state: { notice: 'Your session ended. Please sign in again.' } })
      }),
    [navigate, queryClient],
  )

  const signedIn = useCallback(
    (user: SessionUser) => {
      queryClient.clear()
      queryClient.setQueryData(['me'], user)
    },
    [queryClient],
  )

  const signOut = useCallback(async () => {
    await api('/auth/logout', { method: 'POST' }).catch(() => undefined)
    queryClient.clear()
    queryClient.setQueryData(['me'], null)
    navigate('/login', { replace: true })
  }, [navigate, queryClient])

  const updateUser = useCallback((user: SessionUser) => queryClient.setQueryData(['me'], user), [queryClient])

  const value = useMemo<AuthValue>(
    () => ({ user: me.data ?? null, loading: me.isPending, signedIn, signOut, updateUser }),
    [me.data, me.isPending, signedIn, signOut, updateUser],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth must be used inside AuthProvider')
  return value
}

/** The signed-in user. Only use under <RequireAuth>. */
export function useUser(): SessionUser {
  const { user } = useAuth()
  if (!user) throw new Error('useUser called without a signed-in user')
  return user
}
