import { useState } from 'react'
import { Link } from 'react-router-dom'
import { del, post, useFetch, type Assignment } from '../api'
import { nextAction, stageLine, type Stage } from './stage'

interface Row extends Assignment {
  turnedIn: number; complete: number; roster: number; stage: Stage; toCheck: number; missingSide: number; analysed: number
  notIn: string[]; noticing: { text: string; at: string } | null; pileId: number | null; feedbackPrintedOn: string | null
}

export default function Assignments() {
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<Row[]>('/api/assignments', bump)
  const { data: settings } = useFetch<{ hasKey: boolean }>('/api/settings')
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
    if (!window.confirm(`Delete ${a.code} · ${a.title}? Nothing has been scanned for it. Pages printed with this code would then land in loose pages.`)) return
    try {
      setErr(null)
      await del(`/api/assignments/${a.code}`)
      setBump((b) => b + 1)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  const [rowErr, setRowErr] = useState<Record<string, string>>({})

  const [busy, setBusy] = useState<string | null>(null)

  async function analyse(a: Row) {
    if (busy) return
    if (a.missingSide > 0 && !window.confirm(a.missingSide === 1 ? '1 packet is missing a side. Analyse it as it is?' : `${a.missingSide} packets are missing a side. Analyse them as they are?`)) return
    setBusy(a.code)
    try {
      setRowErr((r) => ({ ...r, [a.code]: '' }))
      await post(`/api/analyse/assignment/${a.code}`, a.missingSide > 0 ? { closeIncomplete: true } : {})
      setBump((b) => b + 1)
    } catch (e) {
      setRowErr((r) => ({ ...r, [a.code]: (e as Error).message }))
      setBump((b) => b + 1)
    } finally {
      setBusy(null)
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

  const analysisOn = !!settings?.hasKey
  const actions = new Map((shown ?? []).map((a) => [a.code, nextAction({ ...a, analysisOn })]))
  // one red button on the screen: the first row whose next step is a real job (check, analyse or copy the prompt, print), not just opening
  const primary = shown?.find((a) => !a.waiting && actions.get(a.code)!.label !== 'Open')?.code
  const noticed = (data ?? []).filter((a) => a.noticing)

  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over">Assignments</div>
        <h1 className="serif title">Assignments</h1>
        <p className="lede">Each assignment, where it is, and what comes next.</p>
        {error && <p className="err">{error}</p>}
        {err && !showForm && <p className="err">{err}</p>}
      </section>

      <section className="col" style={{ gap: 0 }}>
        {shown?.map((a) => {
          const act = actions.get(a.code)!
          const cls = a.code === primary && !showForm ? 'btn primary' : 'btn'
          return (
            <div key={a.code} className="col" style={{ gap: 4, padding: '12px 0', borderTop: '1px solid var(--chip)', opacity: a.waiting ? 0.6 : 1 }}>
              <div className="between" style={{ gap: 12, alignItems: 'flex-start' }}>
                <div className="col" style={{ gap: 2, minWidth: 0 }}>
                  <div><span className="muted">{a.code}</span> <Link to={`/assignments/${a.code}`} className="name">{a.title}</Link> <span className="muted small">{a.klass}{a.grade != null && ` · G${a.grade}`}</span></div>
                  <div className="muted small">{a.waiting ? 'Printed, nothing scanned yet' : stageLine(a)}</div>
                </div>
                <div className="row" style={{ flexShrink: 0 }}>
                  {act.kind === 'analyse' ? <button className={cls} disabled={busy !== null} onClick={() => void analyse(a)}>{act.label}</button>
                    : act.kind === 'print' ? <a className={cls} href={act.to} target="_blank" rel="noreferrer">{act.label}</a>
                    : <Link className={cls} to={act.to}>{act.label}</Link>}
                  {a.turnedIn === 0 && <button className="btn" onClick={() => void remove(a)} title="Delete this assignment. Only possible while nothing has been scanned for it.">Delete</button>}
                </div>
              </div>
              {a.notIn.length > 0 && <div className="muted small">not yet in: {a.notIn.slice(0, 5).join(', ')}{a.notIn.length > 5 && ` and ${a.notIn.length - 5} more`}</div>}
              {rowErr[a.code] && <p className="err" style={{ margin: 0 }}>{rowErr[a.code]}</p>}
            </div>
          )
        })}
        {shown && shown.length === 0 && <p className="muted">{waiting.length ? 'Nothing scanned yet.' : 'No assignments yet. Add one, or scan a pile and name it.'}</p>}
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

      {noticed.length > 0 && (
        <section className="col sep">
          <div className="over">Worth noticing</div>
          {noticed.map((a) => <p key={a.code} style={{ margin: 0 }}>{a.code}: {a.noticing!.text}</p>)}
        </section>
      )}
    </main>
  )
}
