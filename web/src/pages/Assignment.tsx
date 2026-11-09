import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { post, useFetch, fmtDate, fileUrl, sideLabel, type Assignment, type Packet, type Page, type Student } from '../api'

interface Row extends Student { packet: Packet | null; pages: Page[] }
interface Rating { student: string; assignment: string; domain: string; level: number; note: string | null }
interface Data { assignment: Assignment; expected: number; students: Row[]; inReview: number; average: number | null; scoredCount: number; noticing: { text: string; at: string } | null; analysisOn: boolean; domains: string[]; ratings: Rating[] }
const LEVEL_NAME: Record<number, string> = { 4: 'Strong', 3: 'Secure', 2: 'Developing', 1: 'Beginning' }
const LEVEL_BG: Record<number, string> = { 4: '#dff0e5', 3: '#eef5e9', 2: '#fff3d6', 1: '#f8dcd8' }
const shortDomain = (d: string) => d.split(':')[0].trim()
interface Job { assignment: string; student: string | null; state: 'waiting' | 'running' | 'done' | 'failed'; error?: string }
interface QueueStatus { running: boolean; waiting: number; jobs: Job[] }

export default function AssignmentPage() {
  const { code } = useParams()
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<Data>(`/api/assignments/${code}`, bump)
  const [open, setOpen] = useState<string | null>(null)
  const [editing, setEditing] = useState(false)
  const [pasting, setPasting] = useState(false)
  const { data: queue } = useFetch<QueueStatus>('/api/analyse')
  const [analyseErr, setAnalyseErr] = useState<string | null>(null)
  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>
  const a = data.assignment
  const inRows = data.students.filter((s) => s.packet)
  const complete = inRows.filter((s) => s.packet!.complete && !s.packet!.closedIncomplete)
  const out = data.students.filter((s) => !s.packet)
  const sorted = [...inRows].sort((x, y) => (y.packet!.score ?? -1) - (x.packet!.score ?? -1) || x.name.localeCompare(y.name))
  const selected = open ? data.students.find((s) => s.code === open) : null
  const scoreOf = inRows.find((s) => s.packet!.scoreOf != null)?.packet!.scoreOf ?? null
  const mine = (queue?.jobs ?? []).filter((j) => j.assignment === a.code)
  const active = mine.filter((j) => j.state === 'waiting' || j.state === 'running')
  const failed = mine.filter((j) => j.state === 'failed')
  const analysed = inRows.filter((r) => r.packet!.analysedAt).length
  async function analyseAll(force = false) {
    try {
      setAnalyseErr(null)
      await post(`/api/analyse/assignment/${a.code}`, { force })
      setBump((b) => b + 1)
    } catch (e) {
      setAnalyseErr((e as Error).message)
    }
  }

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
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel' : 'Edit'}</button>
          <a className="btn" href={`/print/labels/${a.code}`} target="_blank" rel="noreferrer">Print labels</a>
          <Link className="btn" to={`/compare?assignment=${a.code}`}>Compare</Link>
        </div>
        {editing && <EditForm a={a} onDone={() => { setEditing(false); setBump((b) => b + 1) }} />}
      </section>

      <section className="stats">
        <div className="stat"><div className="over quiet">Turned in</div><div className="num">{inRows.length}<small> of {data.students.length}</small></div></div>
        <div className="stat"><div className="over quiet">Complete</div><div className="num">{complete.length}</div><div className="muted small">{data.expected} side{data.expected === 1 ? '' : 's'} each</div></div>
        <div className="stat"><div className="over quiet">Class average</div><div className="num">{data.average != null ? data.average.toFixed(1) : '—'}{data.average != null && scoreOf != null && <small> of {scoreOf}</small>}</div><div className="muted small">{data.scoredCount} scored</div></div>
        <div className="stat"><div className="over quiet">In review</div><div className="num"><Link to="/review">{data.inReview}</Link></div></div>
      </section>

      {inRows.length > 0 && (
        <section className="col" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 10 }}>
            {data.analysisOn ? (
              <>
                <button className="btn primary" onClick={() => void analyseAll(false)} disabled={active.length > 0} title={analysed < inRows.length ? `Read the ${inRows.length - analysed} packet${inRows.length - analysed === 1 ? '' : 's'} not yet analysed, then write the class summary` : 'Every packet has been analysed; this rewrites the class summary'}>
                  {active.length > 0 ? `Analysing ${active.filter((j) => j.state === 'running')[0]?.student ?? ''}… ${active.length} to go` : analysed < inRows.length ? `Analyse ${inRows.length - analysed === inRows.length ? 'all' : `the ${inRows.length - analysed} new`} with Claude` : 'Rewrite the class summary'}
                </button>
                {analysed > 0 && active.length === 0 && <button className="btn" onClick={() => { if (window.confirm(`Analyse all ${inRows.length} packets again? Existing analysis and feedback are replaced.`)) void analyseAll(true) }}>Analyse everything again</button>}
              </>
            ) : (
              <Link className="btn primary" to="/settings" title="Add a Claude API key and the analysis runs here">Switch on analysis</Link>
            )}
            <a className="btn" href={`/api/assignments/${a.code}/pdf?download=1`} title="Every student's pages, in name order, one PDF">Class PDF</a>
            <a className="btn" href={`/print/overview/${a.code}`} target="_blank" rel="noreferrer" title="For your records: the domain table, then every student's notes and feedback">Print record</a>
            <CopyPrompt code={a.code} />
          <button className="btn" onClick={() => setPasting((v) => !v)} title="Paste Claude's whole answer once; it is split by student code">{pasting ? 'Cancel paste' : 'Paste class answer'}</button>
          {inRows.some((r) => r.packet!.feedback) && <a className="btn" href={`/print/feedback/${a.code}`} target="_blank" rel="noreferrer" title="Every student's note, two slips to a page, to print and hand back with the work">Feedback slips</a>}
          </div>
          <div className="muted small">{data.analysisOn ? `${analysed} of ${inRows.length} packets analysed.` : 'Without a key:'} Class PDF and Copy prompt go to Claude by hand, and Paste class answer brings the reply back.</div>
          {analyseErr && <p className="err" style={{ margin: 0 }}>{analyseErr}</p>}
          {failed.length > 0 && <div className="notice" style={{ borderColor: 'var(--accent)' }}>{failed.length} analysis job{failed.length === 1 ? '' : 's'} failed: {failed[0].error}</div>}
        </section>
      )}
      {pasting && <PasteAnswer code={a.code} onDone={() => { setPasting(false); setBump((b) => b + 1) }} />}

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
        <PacketPanel key={`${selected.code}:${selected.packet.analysedAt ?? ''}:${data.ratings.filter((r) => r.student === selected.code).map((r) => r.level).join('')}`} s={selected} a={a} onSaved={() => setBump((b) => b + 1)} analysisOn={data.analysisOn} busyJob={active.some((j) => j.student === selected.code)} domains={data.domains} ratings={data.ratings.filter((r) => r.student === selected.code)} />
      )}

      <section className="grid2 sep">
        <div className="col" style={{ gap: 10 }}>
          <div className="over">What the class shows</div>
          {data.noticing && <p className="serif" style={{ margin: 0, fontSize: 19, lineHeight: 1.35, fontStyle: 'italic' }}>{data.noticing.text}</p>}
          <ClassAnalysis key={a.analysis ?? ''} a={a} onSaved={() => setBump((b) => b + 1)} />
        </div>
        <div className="col" style={{ gap: 10 }}>
          <div className="over">Scores</div>
          <ScoreTable rows={sorted} />
          <div className="row"><a className="btn" href={`/api/assignments/${a.code}`} target="_blank" rel="noreferrer">JSON</a></div>
        </div>
      </section>

      {inRows.length > 0 && (
        <section className="col sep" style={{ gap: 12 }}>
          <div className="between">
            <div><span className="serif" style={{ fontSize: 26, fontWeight: 700 }}>Overview</span> <span className="muted small" style={{ marginLeft: 8 }}>every student by domain, 1 to 4</span></div>
            <div className="row"><a className="btn" href={`/print/overview/${a.code}`} target="_blank" rel="noreferrer">Print record</a><Link className="btn" to="/settings" title="The domains are set in Settings">Domains</Link></div>
          </div>
          <Overview rows={sorted} domains={data.domains} ratings={data.ratings} onPick={(code) => setOpen(code)} />
        </section>
      )}
    </main>
  )
}

function PacketPanel({ s, a, onSaved, analysisOn, busyJob, domains, ratings }: { s: Row; a: Assignment; onSaved: () => void; analysisOn: boolean; busyJob: boolean; domains: string[]; ratings: Rating[] }) {
  const p = s.packet!
  const [levels, setLevels] = useState<Record<string, number>>(Object.fromEntries(ratings.map((r) => [r.domain, r.level])))
  const [editLevels, setEditLevels] = useState(false)
  async function saveDomains() {
    try {
      setErr(null)
      await post(`/api/packets/${a.code}/${s.code}/domains`, { domains: domains.filter((d) => levels[d]).map((d) => ({ domain: d, level: levels[d], note: ratings.find((r) => r.domain === d)?.note ?? null })) })
      setEditLevels(false)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function analyseOne() {
    try {
      setErr(null)
      await post(`/api/analyse/packet/${a.code}/${s.code}`, {})
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const [score, setScore] = useState(p.score != null ? String(p.score) : '')
  const [of, setOf] = useState(p.scoreOf != null ? String(p.scoreOf) : '10')
  const [note, setNote] = useState(p.note ?? '')
  const [feedback, setFeedback] = useState(p.feedback ?? '')
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pages, setPages] = useState<Page[]>(s.pages)
  const [moving, setMoving] = useState(false)
  async function move(i: number, dir: -1 | 1) {
    const j = i + dir
    if (j < 0 || j >= pages.length) return
    const next = [...pages]
    ;[next[i], next[j]] = [next[j], next[i]]
    setMoving(true)
    try {
      setErr(null)
      setPages(await post<Page[]>(`/api/packets/${a.code}/${s.code}/order`, { pageIds: next.map((pg) => pg.id) }))
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setMoving(false)
    }
  }
  async function unfile(pg: Page) {
    if (!window.confirm(`Send ${sideLabel(pg.page, pg.side)} back to Review? It leaves ${s.name}'s packet and can be filed under someone else there.`)) return
    try {
      setErr(null)
      await post(`/api/pages/${pg.id}/unfile`, {})
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function save() {
    try {
      setErr(null)
      await post(`/api/packets/${a.code}/${s.code}/score`, { score: score === '' ? null : Number(score), scoreOf: of === '' ? null : Number(of), note: note || null, feedback })
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
        <div className="row">
          {analysisOn && <button className="btn primary" disabled={busyJob} onClick={() => void analyseOne()} title={p.analysedAt ? `Analysed ${fmtDate(p.analysedAt)}; read it again` : 'Read these pages with Claude'}>{busyJob ? 'Analysing…' : p.analysedAt ? 'Analyse again' : 'Analyse'}</button>}
          <a className="btn" href={`/api/packets/${a.code}/${s.code}/pdf?download=1`} title="This student's pages as one PDF">PDF</a>
          {p.feedback && <a className="btn" href={`/print/feedback/${a.code}/${s.code}`} target="_blank" rel="noreferrer" title="The note to this student, as a slip to print or save as PDF">Feedback slip</a>}
          <Link className="btn" to={`/compare?assignment=${a.code}&left=${s.code}`}>Compare</Link>
        </div>
      </div>
      <div className="thumbs" style={{ opacity: moving ? 0.6 : 1 }}>
        {pages.map((pg, i) => (
          <div key={pg.id} className="thumb">
            <a href={fileUrl(pg.filePath)} target="_blank" rel="noreferrer"><img src={fileUrl(pg.thumbPath ?? pg.filePath)} alt={sideLabel(pg.page, pg.side)} /></a>
            <span className="between" style={{ gap: 4 }}>
              <span>{sideLabel(pg.page, pg.side)}</span>
              <span className="row" style={{ gap: 2 }}>
                <button className="btn" style={{ padding: '1px 6px' }} disabled={i === 0 || moving} onClick={() => void move(i, -1)} title="Move this page earlier" aria-label="Move earlier">‹</button>
                <button className="btn" style={{ padding: '1px 6px' }} disabled={i === pages.length - 1 || moving} onClick={() => void move(i, 1)} title="Move this page later" aria-label="Move later">›</button>
                <button className="btn" style={{ padding: '1px 6px' }} onClick={() => void unfile(pg)} title="Not this student's page: send it back to Review" aria-label="Send back to review">×</button>
              </span>
            </span>
          </div>
        ))}
      </div>
      <div className="muted small">Pages out of order? The arrows move a page; sides are renumbered by position. × sends a page back to Review.</div>
      <div className="row" style={{ gap: 6 }}>
        <span className="over quiet" style={{ fontSize: 10, marginRight: 4 }}>Domains</span>
        {domains.map((d) => {
          const r = ratings.find((x) => x.domain === d)
          return editLevels ? (
            <label key={d} className="chip row" style={{ gap: 4 }}>{shortDomain(d)}
              <select value={levels[d] ?? ''} onChange={(e) => setLevels({ ...levels, [d]: Number(e.target.value) })} style={{ padding: '1px 4px', height: 'auto' }}><option value="">·</option>{[4, 3, 2, 1].map((l) => <option key={l} value={l}>{l} {LEVEL_NAME[l]}</option>)}</select>
            </label>
          ) : (
            <span key={d} className="chip" title={r?.note ?? 'not rated'} style={{ background: r ? LEVEL_BG[r.level] : undefined }}>{shortDomain(d)} <b>{r ? r.level : '·'}</b></span>
          )
        })}
        {editLevels ? <><button className="btn" onClick={() => void saveDomains()}>Save</button><button className="btn" onClick={() => setEditLevels(false)}>Cancel</button></> : <button className="btn" onClick={() => setEditLevels(true)}>{ratings.length ? 'Edit' : 'Rate'}</button>}
      </div>
      <form className="col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
        <div className="row" style={{ gap: 12 }}>
          <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>Score</span><input type="number" step="0.5" min={0} value={score} onChange={(e) => { setScore(e.target.value); setSaved(false) }} style={{ width: 70 }} /></label>
          <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>of</span><input type="number" step="1" min={1} value={of} onChange={(e) => { setOf(e.target.value); setSaved(false) }} style={{ width: 70 }} /></label>
          <button type="submit" className="btn primary" style={{ marginLeft: 'auto' }}>Save</button>
          {saved && <span className="muted small">Saved</span>}
          {err && <span className="err">{err}</span>}
        </div>
        <div className="grid2" style={{ gap: 16 }}>
          <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Analysis · for you</span>
            <textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(false) }} placeholder="What the work shows: paste Claude's answer for this student, or write your own." rows={Math.max(4, Math.min(14, Math.max(note.split('\n').length, feedback.split('\n').length) + 2))} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
          </label>
          <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Feedback · for {s.name.replace(/\s*\(.*\)\s*$/, '').split(' ').slice(-1)[0]}</span>
            <textarea value={feedback} onChange={(e) => { setFeedback(e.target.value); setSaved(false) }} placeholder="The note the student reads. Warm, specific, their own words quoted. Printed as a slip." rows={Math.max(4, Math.min(14, Math.max(note.split('\n').length, feedback.split('\n').length) + 2))} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
          </label>
        </div>
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


function EditForm({ a, onDone }: { a: Assignment; onDone: () => void }) {
  const [f, setF] = useState({ title: a.title, klass: a.klass, grade: a.grade == null ? '' : String(a.grade), assignedOn: a.assignedOn ?? '', sheets: a.sheets, twoSided: !!a.twoSided, sides: a.sides == null ? '' : String(a.sides), tags: a.tags })
  const [err, setErr] = useState<string | null>(null)
  const { data: classes } = useFetch<{ classes: string[] }>('/api/students')
  const max = f.sheets * (f.twoSided ? 2 : 1)
  async function save() {
    try {
      setErr(null)
      await fetch(`/api/assignments/${a.code}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, grade: f.grade === '' ? null : Number(f.grade), sides: f.sides === '' ? null : Number(f.sides) }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error ?? r.statusText) })
      onDone()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <form className="card" style={{ gap: 10, marginTop: 8 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="muted small">The code {a.code} stays: it is printed on the pages already. Changing sheets or sides recounts every packet.</div>
      <div className="row" style={{ gap: 12 }}>
        <label className="col" style={{ gap: 4, flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Title</span><input type="text" required value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} /></label>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Class</span><input type="text" required list="edit-classes" value={f.klass} onChange={(e) => setF({ ...f, klass: e.target.value })} style={{ width: 140 }} /><datalist id="edit-classes">{classes?.classes.map((c) => <option key={c} value={c} />)}</datalist></label>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Grade</span><input type="number" min={1} max={6} value={f.grade} onChange={(e) => setF({ ...f, grade: e.target.value })} style={{ width: 70 }} /></label>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Assigned</span><input type="date" value={f.assignedOn} onChange={(e) => setF({ ...f, assignedOn: e.target.value })} /></label>
      </div>
      <div className="row" style={{ gap: 12 }}>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Sheets</span><input type="number" min={1} max={20} value={f.sheets} onChange={(e) => setF({ ...f, sheets: Number(e.target.value) })} style={{ width: 70 }} /></label>
        <label className="row" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}><input type="checkbox" checked={f.twoSided} onChange={(e) => setF({ ...f, twoSided: e.target.checked })} /> Both sides are used</label>
        <label className="col" style={{ gap: 4 }} title="Only when fewer sides are actually used than sheets × sides, such as 2 sheets both sides but the last back blank: 3"><span className="over quiet" style={{ fontSize: 10 }}>Sides in all</span><input type="number" min={1} max={max} value={f.sides} placeholder={String(max)} onChange={(e) => setF({ ...f, sides: e.target.value })} style={{ width: 80 }} /></label>
        <label className="col" style={{ gap: 4, flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Tags</span><input type="text" value={f.tags} onChange={(e) => setF({ ...f, tags: e.target.value })} /></label>
      </div>
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
      <div className="row"><button type="submit" className="btn primary">Save</button><button type="button" className="btn" onClick={onDone}>Cancel</button></div>
    </form>
  )
}

function CopyPrompt({ code }: { code: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  async function copy() {
    try {
      const text = await fetch(`/api/assignments/${code}/prompt`).then((r) => r.text())
      await navigator.clipboard.writeText(text)
      setState('copied')
    } catch {
      setState('failed')
    }
    setTimeout(() => setState('idle'), 2500)
  }
  return (
    <span className="row" style={{ gap: 6 }}>
      <button className="btn" onClick={() => void copy()} title="A prompt for Claude naming the assignment and every student by code, shaped so the answer pastes straight back">Copy prompt</button>
      {state === 'copied' && <span className="muted small">Copied. Paste it into Claude with the PDF.</span>}
      {state === 'failed' && <a className="small" href={`/api/assignments/${code}/prompt`} target="_blank" rel="noreferrer">Open the prompt instead</a>}
    </span>
  )
}

function PasteAnswer({ code, onDone }: { code: string; onDone: () => void }) {
  const [text, setText] = useState('')
  const [result, setResult] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  async function send() {
    try {
      setErr(null)
      const r = await post<{ students: string[]; withFeedback: number; klass: boolean; unmatched: string[] }>(`/api/assignments/${code}/analysis/paste`, { text })
      setResult(`Filed analysis for ${r.students.length} student${r.students.length === 1 ? '' : 's'}${r.withFeedback ? `, feedback for ${r.withFeedback}` : ''}${r.klass ? ', and the class' : ''}.${r.unmatched.length ? ` Nothing found for ${r.unmatched.join(', ')}.` : ''}`)
      setTimeout(onDone, 1800)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <section className="card" style={{ gap: 10 }}>
      <div className="over quiet">Paste Claude's whole answer</div>
      <div className="muted small">Each part that starts with a student's code goes to that student, split into the Teacher part and the Feedback part; a part headed Class goes to What the class shows. Anything already there for those students is replaced.</div>
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={12} placeholder={'## 4S18 Lee Yoona\n### Teacher\n…\n### Feedback\n…\n\n## Class\n…'} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
      <div className="row"><button className="btn primary" disabled={!text.trim()} onClick={() => void send()}>File it</button>{result && <span className="small">{result}</span>}{err && <span className="err">{err}</span>}</div>
    </section>
  )
}

function ClassAnalysis({ a, onSaved }: { a: Assignment; onSaved: () => void }) {
  const [text, setText] = useState(a.analysis ?? '')
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    try {
      setErr(null)
      await post(`/api/assignments/${a.code}/analysis`, { analysis: text })
      setSaved(true)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  return (
    <form className="col" style={{ gap: 8 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
      <textarea value={text} onChange={(e) => { setText(e.target.value); setSaved(false) }} rows={text ? Math.min(18, text.split('\n').length + 2) : 4} placeholder="What the whole class shows: paste the Class part of Claude's answer, or write your own." style={{ width: '100%', font: 'inherit', fontSize: 13.5, lineHeight: 1.5, padding: '10px 12px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
      <div className="row"><button type="submit" className="btn primary">Save</button>{saved && <span className="muted small">Saved</span>}{err && <span className="err">{err}</span>}</div>
    </form>
  )
}


function Overview({ rows, domains, ratings, onPick }: { rows: Row[]; domains: string[]; ratings: Rating[]; onPick: (code: string) => void }) {
  const level = (student: string, d: string) => ratings.find((r) => r.student === student && r.domain === d)
  const avg = (d: string) => { const xs = ratings.filter((r) => r.domain === d).map((r) => r.level); return xs.length ? (xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(1) : '' }
  if (!ratings.length) return <div className="notice">No domain ratings yet. Analyse the assignment, paste Claude's answer, or click a student and Rate.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>Student</th><th style={{ textAlign: 'center' }}>Score</th>{domains.map((d) => <th key={d} style={{ textAlign: 'center' }} title={d}>{shortDomain(d)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} style={{ cursor: 'pointer' }} onClick={() => onPick(r.code)}>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td style={{ textAlign: 'center' }}>{r.packet!.score != null ? `${r.packet!.score}${r.packet!.scoreOf != null ? `/${r.packet!.scoreOf}` : ''}` : <span className="muted">—</span>}</td>
              {domains.map((d) => { const x = level(r.code, d); return <td key={d} style={{ textAlign: 'center', background: x ? LEVEL_BG[x.level] : undefined }} title={x?.note ?? ''}>{x ? x.level : <span className="muted">·</span>}</td> })}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td style={{ fontWeight: 600, borderTop: '2px solid var(--line)' }}>Class average</td><td style={{ borderTop: '2px solid var(--line)' }}></td>{domains.map((d) => <td key={d} style={{ textAlign: 'center', fontWeight: 600, borderTop: '2px solid var(--line)' }}>{avg(d)}</td>)}</tr></tfoot>
      </table>
    </div>
  )
}
