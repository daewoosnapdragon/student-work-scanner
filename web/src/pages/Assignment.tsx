import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { post, useFetch, fmtDate, fileUrl, sideLabel, type Assignment, type Packet, type Page, type Student } from '../api'

interface Row extends Student { packet: Packet | null; pages: Page[] }
interface Data { assignment: Assignment; expected: number; students: Row[]; inReview: number; average: number | null; scoredCount: number }

export default function AssignmentPage() {
  const { code } = useParams()
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<Data>(`/api/assignments/${code}`, bump)
  const [open, setOpen] = useState<string | null>(null)
  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>
  const a = data.assignment
  const inRows = data.students.filter((s) => s.packet)
  const complete = inRows.filter((s) => s.packet!.complete && !s.packet!.closedIncomplete)
  const out = data.students.filter((s) => !s.packet)
  const sorted = [...inRows].sort((x, y) => (y.packet!.score ?? -1) - (x.packet!.score ?? -1) || x.name.localeCompare(y.name))
  const selected = open ? data.students.find((s) => s.code === open) : null
  const scoreOf = inRows.find((s) => s.packet!.scoreOf != null)?.packet!.scoreOf ?? null

  return (
    <main style={{ gap: 32 }}>
      <section className="col" style={{ gap: 12 }}>
        <div className="over"><Link to="/assignments">Assignments</Link> <span className="muted">/</span> {a.code}</div>
        <h1 className="serif title">{a.title}</h1>
        <p className="serif" style={{ margin: 0, fontSize: 17, fontStyle: 'italic', color: 'var(--ink2)' }}>
          {[a.code, a.grade != null && `Grade ${a.grade}`, a.klass, a.assignedOn && `assigned ${fmtDate(a.assignedOn)}`, `${a.sheets} sheet${a.sheets === 1 ? '' : 's'}${a.twoSided ? ', both sides' : ''}`].filter(Boolean).join(' · ')}
        </p>
        <div className="row">
          {a.tags && <><span className="over quiet" style={{ fontSize: 10, marginRight: 4 }}>Tags</span>{a.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <span key={t} className="chip">{t}</span>)}</>}
          <a className="btn" style={{ marginLeft: 'auto' }} href={`/print/labels/${a.code}`} target="_blank" rel="noreferrer">Print labels</a>
          <Link className="btn" to={`/compare?assignment=${a.code}`}>Compare</Link>
        </div>
      </section>

      <section className="stats">
        <div className="stat"><div className="over quiet">Turned in</div><div className="num">{inRows.length}<small> of {data.students.length}</small></div></div>
        <div className="stat"><div className="over quiet">Complete</div><div className="num">{complete.length}</div><div className="muted small">{data.expected} side{data.expected === 1 ? '' : 's'} each</div></div>
        <div className="stat"><div className="over quiet">Class average</div><div className="num">{data.average != null ? data.average.toFixed(1) : '—'}{data.average != null && scoreOf != null && <small> of {scoreOf}</small>}</div><div className="muted small">{data.scoredCount} scored</div></div>
        <div className="stat"><div className="over quiet">In review</div><div className="num"><Link to="/review">{data.inReview}</Link></div></div>
      </section>

      <section className="col">
        <div className="between">
          <div className="over">Who is in</div>
          <div className="muted small">Dashed means not scanned yet; amber means a side is still missing. Click a name to see the pages and enter a score.</div>
        </div>
        <div className="row">
          {sorted.map((s) => (
            <button key={s.code} className={`tile ${!s.packet!.complete || s.packet!.closedIncomplete ? 'part' : ''}`} style={open === s.code ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined} onClick={() => setOpen(open === s.code ? null : s.code)}>
              {s.name}{s.packet!.score != null ? ` · ${s.packet!.score}` : s.packet!.sides < s.packet!.expected ? ` · ${s.packet!.sides}/${s.packet!.expected}` : ''}
            </button>
          ))}
          {out.map((s) => <Link key={s.code} to={`/students/${s.code}`} className="tile out">{s.name}</Link>)}
        </div>
      </section>

      {selected && selected.packet && (
        <PacketPanel key={selected.code} s={selected} a={a} onSaved={() => setBump((b) => b + 1)} />
      )}

      <section className="grid2 sep">
        <div className="col" style={{ gap: 10 }}>
          <div className="over">What the class shows</div>
          <div className="notice">Analysis is not switched on yet. When it is, every answer to one question will sit here side by side, with what the class got right and what to teach next.</div>
        </div>
        <div className="col" style={{ gap: 10 }}>
          <div className="over">Scores</div>
          <ScoreTable rows={sorted} />
          <div className="row"><a className="btn" href={`/api/assignments/${a.code}`} target="_blank" rel="noreferrer">JSON</a></div>
        </div>
      </section>
    </main>
  )
}

function PacketPanel({ s, a, onSaved }: { s: Row; a: Assignment; onSaved: () => void }) {
  const p = s.packet!
  const [score, setScore] = useState(p.score != null ? String(p.score) : '')
  const [of, setOf] = useState(p.scoreOf != null ? String(p.scoreOf) : '10')
  const [note, setNote] = useState(p.note ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  async function save() {
    try {
      setErr(null)
      await post(`/api/packets/${a.code}/${s.code}/score`, { score: score === '' ? null : Number(score), scoreOf: of === '' ? null : Number(of), note: note || null })
      setSaved(true)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <section className="card" style={{ padding: 20, gap: 14 }}>
      <div className="between">
        <div><Link to={`/students/${s.code}`} className="serif" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{s.name}</Link> <span className="muted small" style={{ marginLeft: 8 }}>{s.code} · {p.sides} of {p.expected} sides{p.closedIncomplete ? ', filed incomplete' : ''} · last page {fmtDate(p.lastAt)}</span></div>
        <Link className="btn" to={`/compare?assignment=${a.code}&left=${s.code}`}>Compare</Link>
      </div>
      <div className="thumbs">
        {s.pages.map((pg) => (
          <a key={pg.id} className="thumb" href={fileUrl(pg.filePath)} target="_blank" rel="noreferrer">
            <img src={fileUrl(pg.thumbPath ?? pg.filePath)} alt={sideLabel(pg.page, pg.side)} />
            <span>{sideLabel(pg.page, pg.side)}</span>
          </a>
        ))}
      </div>
      <form className="row" style={{ gap: 12 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
        <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>Score</span><input type="number" step="0.5" min={0} value={score} onChange={(e) => { setScore(e.target.value); setSaved(false) }} style={{ width: 70 }} /></label>
        <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>of</span><input type="number" step="1" min={1} value={of} onChange={(e) => { setOf(e.target.value); setSaved(false) }} style={{ width: 70 }} /></label>
        <label className="row" style={{ flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Note</span><input type="text" value={note} onChange={(e) => { setNote(e.target.value); setSaved(false) }} placeholder="What you noticed" style={{ flex: 1 }} /></label>
        <button type="submit" className="btn primary">Save</button>
        {saved && <span className="muted small">Saved</span>}
        {err && <span className="err">{err}</span>}
      </form>
    </section>
  )
}

function ScoreTable({ rows }: { rows: Row[] }) {
  const scored = rows.filter((r) => r.packet?.score != null)
  if (!scored.length) return <p className="muted small" style={{ margin: 0 }}>No scores entered yet. Click a name above to enter one.</p>
  const buckets = new Map<number, number>()
  for (const r of scored) {
    const k = Math.round(r.packet!.score!)
    buckets.set(k, (buckets.get(k) ?? 0) + 1)
  }
  const keys = [...buckets.keys()].sort((a, b) => b - a)
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>Score</th><th style={{ textAlign: 'right' }}>Students</th></tr></thead>
        <tbody>{keys.map((k) => <tr key={k}><td>{k}</td><td style={{ textAlign: 'right' }}>{buckets.get(k)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}
