import { NavLink, Outlet } from 'react-router'
import { RULES } from '../../shared/rules'
import { useAuth, useUser } from '../auth'
import { Icon } from './Icon'
import { Avatar } from './ui'

export function Layout() {
  const me = useUser()
  const { signOut } = useAuth()
  return (
    <div className="shell">
      <header className="topbar">
        <div className="topbar-inner">
          <NavLink to="/" className="brand" aria-label="Zocial home">
            <span className="brand-mark" aria-hidden="true" />
            <span className="brand-name">Zocial</span>
          </NavLink>
          <nav className="topnav" aria-label="Main">
            <NavLink to="/" end className="topnav-link">
              <Icon name="home" /> <span>Feed</span>
            </NavLink>
            <NavLink to={`/u/${me.username}`} className="topnav-link">
              <Avatar name={me.displayName} url={me.avatarUrl} size={26} /> <span>Profile</span>
            </NavLink>
            <button type="button" className="topnav-link" onClick={() => void signOut()}>
              <Icon name="logout" /> <span>Sign out</span>
            </button>
          </nav>
        </div>
      </header>
      {me.isDemo && (
        <p className="demo-strip">
          You’re signed in to a shared demo account. Other visitors can see what you post, and the demo data resets from time to time.
        </p>
      )}
      <div className="columns">
        <main className="feed-col" id="main">
          <Outlet />
        </main>
        <aside className="side-col" aria-label="About">
          <section className="card side-card">
            <h2>Community rules</h2>
            <ul className="rules">
              {RULES.map((r) => (
                <li key={r.action}>
                  <strong>{r.action}</strong>
                  <span className="muted">{r.who}</span>
                </li>
              ))}
            </ul>
            <p className="muted small">
              <Icon name="shield" size={14} /> The server checks these on every request.
            </p>
          </section>
        </aside>
      </div>
    </div>
  )
}
