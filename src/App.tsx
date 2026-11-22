import type { ReactNode } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router'
import { useAuth } from './auth'
import { Layout } from './components/Layout'
import { LoginPage, RegisterPage } from './pages/AuthPages'
import { FeedPage, NotFoundPage, PostPage, ProfilePage } from './pages/Pages'

function FullPageLoader() {
  return (
    <div className="full-center" aria-busy="true">
      <span className="spinner" />
      <span className="sr-only">Loading</span>
    </div>
  )
}

function RequireAuth({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  const location = useLocation()
  if (loading) return <FullPageLoader />
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />
  return children
}

function GuestOnly({ children }: { children: ReactNode }) {
  const { user, loading } = useAuth()
  if (loading) return <FullPageLoader />
  if (user) return <Navigate to="/" replace />
  return children
}

export function App() {
  return (
    <Routes>
      <Route path="/login" element={<GuestOnly><LoginPage /></GuestOnly>} />
      <Route path="/register" element={<GuestOnly><RegisterPage /></GuestOnly>} />
      <Route element={<RequireAuth><Layout /></RequireAuth>}>
        <Route index element={<FeedPage />} />
        <Route path="u/:username" element={<ProfilePage />} />
        <Route path="p/:id" element={<PostPage />} />
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  )
}
