import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useEffect, useState } from 'react'
import { useFetch } from '../api'

export default function Shell() {
  const { data } = useFetch<{ items: unknown[] }>('/api/review')
  const count = data?.items.length ?? 0
  const nav = useNavigate()
  const [q, setQ] = useState('')
  // the running program against the files on disk: after an update they differ until the scanner is restarted
  const [stale, setStale] = useState(false)
  useEffect(() => {
    let alive = true
    Promise.all([fetch('/api/status').then((r) => r.json()).catch(() => null), fetch(`/build.txt?${Date.now()}`).then((r) => (r.ok ? r.text() : '')).catch(() => '')])
      .then(([st, disk]) => { if (alive && st?.build && disk && st.build !== 'dev' && st.build.trim() !== disk.trim()) setStale(true) })
    return () => { alive = false }
  }, [])
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <header className="top">
        <NavLink to="/" className="serif brand">Student Work</NavLink>
        <nav>
          <NavLink to="/" end className={({ isActive }) => (isActive ? 'on' : '')}>Today</NavLink>
          <NavLink to="/students" className={({ isActive }) => (isActive ? 'on' : '')}>Students</NavLink>
          <NavLink to="/assignments" className={({ isActive }) => (isActive ? 'on' : '')}>Assignments</NavLink>
          <NavLink to="/compare" className={({ isActive }) => (isActive ? 'on' : '')}>Compare</NavLink>
          <NavLink to="/review" className={({ isActive }) => (isActive ? 'on' : '')}>
            Review{count > 0 && <span className="badge">{count}</span>}
          </NavLink>
        </nav>
        <form
          style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center' }}
          onSubmit={(e) => {
            e.preventDefault()
            const t = q.trim()
            if (!t) return
            if (/^W\d+$/i.test(t)) nav(`/assignments/${t.toUpperCase()}`)
            else if (/^S\d+$/i.test(t)) nav(`/students/${t.toUpperCase()}`)
            else nav(`/students?q=${encodeURIComponent(t)}`)
            setQ('')
          }}
        >
          <label htmlFor="q" className="vh">Search students or assignments</label>
          <input id="q" type="text" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search students or assignments" style={{ width: 240 }} />
        </form>
      </header>
      {stale && (
        <div className="notice" style={{ margin: '12px 32px 0', borderColor: 'var(--accent)' }} data-testid="stale-build">
          <b>The scanner was updated but is still running the old version.</b> Close its black window and start it again from the taskbar; then reload this page.
        </div>
      )}
      <Outlet />
    </div>
  )
}
