import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useState } from 'react'
import { useFetch } from '../api'

export default function Shell() {
  const { data } = useFetch<{ items: unknown[] }>('/api/review')
  const count = data?.items.length ?? 0
  const nav = useNavigate()
  const [q, setQ] = useState('')
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
      <Outlet />
    </div>
  )
}
