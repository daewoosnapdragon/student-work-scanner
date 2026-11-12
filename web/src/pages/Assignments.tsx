import { useState } from 'react'
import { Link } from 'react-router-dom'
import { del, post, useFetch, fmtDate, sideLabel, type Assignment } from '../api'
import { parseExpect } from '../../../shared/types'

interface Row extends Assignment { turnedIn: number; complete: number; roster: number }

export default function Assignments() {
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<Row[]>('/api/assignments', bump)
  const { data: classes } = useFetch<{ classes: string[] }>('/api/students')
  const [form, setForm] = useState({ code: '', title: '', klass: '', grade: '', assignedOn: new Date().toISOString().slice(0, 10), sheets: 1, twoSided: true, tags: '' })
  const [err, setErr] = useState<string | null>(null)
  const [showForm, setShowForm] = useState(false)
  // printed from Worksheet Studio and nothing scanned yet: out of the list until a page arrives, so a set never collected leaves no gap
  const [showWaiting, setShowWaiting] = useState(false)
  const waiting = data?.filter((a) => a.waiting) ?? []
  const shown = data?.filter((a) => showWaiting || !a.waiting)

  async function remove(a: Row) {
    if (a.turnedIn > 0) return setErr(`${a.code} has work from ${a.turnedIn} student${a.turnedIn === 1 ? '' : 's'} filed under it, so it stays.`)
    if (!window.confirm(`Delete ${a.code} · ${a.title}? Nothing has been scanned for it. Labels already printed with this code would land in review.`)) return
    try {
      setErr(null)
      await del(`/api/assignments/${a.code}`)
      setBump((b) => b + 1)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  async function save() {
    try {
      setErr(null)
      await post('/api/assignments', { ...form, grade: form.grade ? Number(form.grade) : null })
      setForm({ ...form, code: '', title: '', tags: '' })
      setShowForm(false)
      setBump((b) => b + 1)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over">Everything handed out</div>
        <h1 className="serif title">Assignments</h1>
        <p className="lede">Each assignment has a code. Print its labels, stick one on each side, and the scanner files the pages on its own.</p>
        {error && <p className="err">{error}</p>}
        {err && !showForm && <p className="err">{err}</p>}
      </section>

      <section style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th style={{ width: 70 }}>Code</th><th>Title</th><th>Class</th><th style={{ width: 100 }}>Assigned</th><th style={{ width: 120 }}>Sides</th><th style={{ width: 120 }}>Turned in</th><th style={{ width: 100 }}>Complete</th><th style={{ width: 210 }}></th></tr></thead>
          <tbody>
            {shown?.map((a) => (
              <tr key={a.code} style={a.waiting ? { opacity: 0.6 } : undefined}>
                <td className="muted">{a.code}</td>
                <td><Link to={`/assignments/${a.code}`} className="name">{a.title}</Link>{a.tags && <div className="kr">{a.tags}</div>}</td>
                <td>{a.klass}{a.grade != null && <span className="muted"> · G{a.grade}</span>}</td>
                <td className="muted">{fmtDate(a.assignedOn)}</td>
                <td>{a.sheets} sheet{a.sheets === 1 ? '' : 's'}{a.twoSided ? ', both sides' : ''}{a.expect && <div className="muted small">{parseExpect(a.expect).map((e) => sideLabel(e.page, e.side)).join(', ')} back</div>}</td>
                <td>{a.waiting ? <span className="muted">printed, nothing scanned yet</span> : <>{a.turnedIn} of {a.roster}</>}</td>
                <td>{a.complete}</td>
                <td className="row"><Link to={`/assignments/${a.code}`} className="btn">Open</Link><a className="btn" href={`/print/labels/${a.code}`} target="_blank" rel="noreferrer">Labels</a>{a.turnedIn === 0 && <button className="btn" onClick={() => void remove(a)} title="Delete this assignment. Only possible while nothing has been scanned for it.">Delete</button>}</td>
              </tr>
            ))}
            {shown && shown.length === 0 && <tr><td colSpan={8} className="muted">{waiting.length ? 'Nothing scanned yet.' : 'No assignments yet. Add the first one below.'}</td></tr>}
          </tbody>
        </table>
        {waiting.length > 0 && <p className="muted small" style={{ marginTop: 8 }}>{waiting.length} printed from Worksheet Studio with nothing scanned yet ({waiting.map((a) => a.code).join(', ')}): {showWaiting ? 'shown faint above.' : 'kept out of the list until a page arrives.'} <button className="lnk" onClick={() => setShowWaiting((v) => !v)} style={{ border: 0, background: 'none', color: 'var(--accent)', padding: 0, font: 'inherit', textDecoration: 'underline', cursor: 'pointer' }}>{showWaiting ? 'Hide them' : 'Show them'}</button></p>}
      </section>

      <section className="col sep">
        <div className="between">
          <div className="over">New assignment</div>
          {!showForm && <button className="btn" onClick={() => setShowForm(true)}>Add an assignment</button>}
        </div>
        {showForm && (
          <form className="col" style={{ maxWidth: 720 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
            <div className="row" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Code</span><input type="text" required value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="W24" style={{ width: 90 }} /></label>
              <label className="col" style={{ gap: 4, flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Title</span><input type="text" required value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} placeholder="Long E Hunt" /></label>
              <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Class</span>
                <input type="text" required list="classes" value={form.klass} onChange={(e) => setForm({ ...form, klass: e.target.value })} placeholder="Daisy" style={{ width: 140 }} />
                <datalist id="classes">{classes?.classes.map((c) => <option key={c} value={c} />)}</datalist>
              </label>
              <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Grade</span><input type="number" min={1} max={6} value={form.grade} onChange={(e) => setForm({ ...form, grade: e.target.value })} style={{ width: 70 }} /></label>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Assigned</span><input type="date" value={form.assignedOn} onChange={(e) => setForm({ ...form, assignedOn: e.target.value })} /></label>
              <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Sheets</span><input type="number" min={1} max={20} value={form.sheets} onChange={(e) => setForm({ ...form, sheets: Number(e.target.value) })} style={{ width: 70 }} /></label>
              <label className="row" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}><input type="checkbox" checked={form.twoSided} onChange={(e) => setForm({ ...form, twoSided: e.target.checked })} /> Both sides are used</label>
              <label className="col" style={{ gap: 4, flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Tags</span><input type="text" value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })} placeholder="phonics, long e" /></label>
            </div>
            {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
            <div className="row"><button type="submit" className="btn primary">Save</button><button type="button" className="btn" onClick={() => setShowForm(false)}>Cancel</button></div>
          </form>
        )}
      </section>
    </main>
  )
}
