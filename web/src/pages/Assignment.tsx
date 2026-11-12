import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import { post, useFetch, fmtDate, fileUrl, sideLabel, type Assignment, type Packet, type Page, type Student } from '../api'
import { formatExpect, parseCorrectionLines, parseCorrections, parseCriteria, parseExpect, type Anchor, type Rubric, type Side } from '../../../shared/types'
import { del, put } from '../api'
import ProgressRow from '../components/ProgressRow'
import { ScanLink, type ViewerPage } from '../components/Viewer'
import AgreementCard, { type Agreement } from '../components/AgreementCard'

interface Row extends Student { packet: Packet | null; pages: Page[] }
interface Rating { student: string; assignment: string; domain: string; level: number; note: string | null; claudeLevel: number | null; by: 'claude' | 'teacher' | null }
interface Data { assignment: Assignment; expected: number; /** Every side printed, whether or not it comes back. */ printed: Array<{ page: number; side: Side }>; students: Row[]; inReview: number; average: number | null; scoredCount: number; noticing: { text: string; at: string } | null; analysisOn: boolean; domains: string[]; allDomains: string[]; rubric: Rubric; ratings: Rating[]; anchors: Anchor[]; agreement: Agreement }
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
          {[a.code, a.grade != null && `Grade ${a.grade}`, a.klass, a.assignedOn && `assigned ${fmtDate(a.assignedOn)}`, `${a.sheets} sheet${a.sheets === 1 ? '' : 's'}${a.twoSided ? ', both sides' : ''}`, a.expect && `${parseExpect(a.expect).map((e) => sideLabel(e.page, e.side)).join(' and ')} come${parseExpect(a.expect).length === 1 ? 's' : ''} back`].filter(Boolean).join(' · ')}
        </p>
        <div className="row">
          {a.tags && <><span className="over quiet" style={{ fontSize: 10, marginRight: 4 }}>Tags</span>{a.tags.split(',').map((t) => t.trim()).filter(Boolean).map((t) => <span key={t} className="chip">{t}</span>)}</>}
          <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setEditing((v) => !v)}>{editing ? 'Cancel' : 'Edit'}</button>
          <a className="btn" href={`/print/labels/${a.code}`} target="_blank" rel="noreferrer">Print labels</a>
          <Link className="btn" to={`/compare?assignment=${a.code}`}>Compare</Link>
        </div>
        {editing && <EditForm a={a} printed={data.printed} onDone={() => { setEditing(false); setBump((b) => b + 1) }} />}
      </section>

      <section className="stats">
        <div className="stat"><div className="over quiet">Turned in</div><div className="num">{inRows.length}<small> of {data.students.length}</small></div></div>
        <div className="stat"><div className="over quiet">Complete</div><div className="num">{complete.length}</div><div className="muted small">{data.expected} side{data.expected === 1 ? '' : 's'} each</div></div>
        <div className="stat"><div className="over quiet">Class average</div><div className="num">{data.average != null ? data.average.toFixed(1) : '—'}{data.average != null && scoreOf != null && <small> of {scoreOf}</small>}</div><div className="muted small">{data.scoredCount} scored</div></div>
        <div className="stat"><div className="over quiet">In review</div><div className="num"><Link to="/review">{data.inReview}</Link></div></div>
      </section>

      <RubricCard key={`${a.code}:${JSON.stringify(data.rubric)}`} a={a} rubric={data.rubric} allDomains={data.allDomains} onSaved={() => setBump((b) => b + 1)} />

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

      {inRows.length > 0 && data.rubric.scoring !== 'none' && (
        <section className="col" style={{ gap: 10 }}>
          <div className="between">
            <div className="over">Scoring anchors</div>
            <div className="muted small">{data.anchors.length ? 'Claude scores every other packet by comparison with these.' : 'Score two or three packets yourself and mark them as anchors; Claude then scores the rest by comparison, in your terms.'}</div>
          </div>
          {data.anchors.length > 0 && (
            <div className="row" style={{ gap: 12, alignItems: 'stretch' }}>
              {data.anchors.map((an) => {
                const row = inRows.find((r) => r.code === an.student)
                const first = row?.pages[0]
                return (
                  <button key={an.student} type="button" className="card" style={{ padding: 10, width: 220, cursor: 'pointer', textAlign: 'left', font: 'inherit', color: 'inherit', borderColor: open === an.student ? 'var(--accent)' : undefined }} onClick={() => setOpen(open === an.student ? null : an.student)}>
                    <div className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                      {first && <img src={fileUrl(first.thumbPath ?? first.filePath)} alt="" style={{ width: 56, height: 72, objectFit: 'cover', objectPosition: 'top', border: '1px solid var(--line)', background: '#fff' }} />}
                      <div className="col" style={{ gap: 2, minWidth: 0 }}>
                        <div className="num" style={{ fontSize: 24, marginTop: 0 }}>{an.score}<small> of {an.scoreOf ?? 4}</small></div>
                        <div style={{ fontWeight: 600, fontSize: 13 }}>{row?.name ?? an.student}</div>
                        {an.note && <div className="muted small" style={{ lineHeight: 1.35 }}>{an.note}</div>}
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </section>
      )}

      <section className="col">
        <div className="between">
          <div className="over">Who is in</div>
          <div className="muted small">Dashed means not scanned yet; amber means a side is still missing. Click a name to see the pages and enter a score.</div>
        </div>
        <div className="row">
          {sorted.map((s) => (
            <button key={s.code} className={`tile ${!s.packet!.complete || s.packet!.closedIncomplete ? 'part' : ''}`} style={open === s.code ? { borderColor: 'var(--accent)', boxShadow: 'inset 0 0 0 1px var(--accent)' } : undefined} onClick={() => setOpen(open === s.code ? null : s.code)}>
              {s.name}{s.packet!.score != null ? ` · ${s.packet!.score}` : s.packet!.sides < s.packet!.expected ? ` · ${s.packet!.sides}/${s.packet!.expected}` : ''}{data.anchors.some((an) => an.student === s.code) && <span title="A scoring anchor" style={{ marginLeft: 6, color: 'var(--accent)', fontWeight: 700 }}>⚓</span>}
            </button>
          ))}
          {out.map((s) => <Link key={s.code} to={`/students/${s.code}`} className="tile out">{s.name}</Link>)}
        </div>
      </section>

      {selected && selected.packet && (
        <PacketPanel key={`${selected.code}:${selected.packet.analysedAt ?? ''}:${data.ratings.filter((r) => r.student === selected.code).map((r) => r.level).join('')}`} s={selected} a={a} onSaved={() => setBump((b) => b + 1)} analysisOn={data.analysisOn} busyJob={active.some((j) => j.student === selected.code)} domains={data.domains} ratings={data.ratings.filter((r) => r.student === selected.code)} anchor={data.anchors.find((an) => an.student === selected.code) ?? null} rubric={data.rubric} />
      )}

      {(data.agreement.score || data.agreement.domains.length > 0) && (
        <section className="col" style={{ gap: 10 }}>
          <div className="between">
            <div className="over">Agreement with your ratings</div>
            <div className="muted small">{data.agreement.compared} packet{data.agreement.compared === 1 ? '' : 's'} rated by both you and Claude</div>
          </div>
          <AgreementCard ag={data.agreement} />
        </section>
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

function PacketPanel({ s, a, onSaved, analysisOn, busyJob, domains, ratings, anchor, rubric }: { s: Row; a: Assignment; onSaved: () => void; analysisOn: boolean; busyJob: boolean; domains: string[]; ratings: Rating[]; anchor: Anchor | null; rubric: Rubric }) {
  const p = s.packet!
  const [anchoring, setAnchoring] = useState(false)
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
  const [scoreTouched, setScoreTouched] = useState(false)
  const [of, setOf] = useState(p.scoreOf != null ? String(p.scoreOf) : '10')
  const [note, setNote] = useState(p.note ?? '')
  const [feedback, setFeedback] = useState(p.feedback ?? '')
  const [fixit, setFixit] = useState(parseCorrections(p.corrections).map((c) => `${c.wrote} → ${c.better}${c.why ? ` — ${c.why}` : ''}`).join('\n'))
  const [err, setErr] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [pages, setPages] = useState<Page[]>(s.pages)
  // Kept for reordering by hand, but it follows the server whenever the page refetches (a comment added, a page sent back).
  useEffect(() => setPages(s.pages), [s.pages])
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
      await post(`/api/packets/${a.code}/${s.code}/score`, { score: score === '' ? null : Number(score), scoreOf: of === '' ? null : Number(of), note: note || null, feedback, corrections: fixit, scoreTouched })
      setSaved(true)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const panel = (p.note || p.feedback || parseCorrections(p.corrections).length) ? (
    <>
      <div className="over" style={{ fontSize: 10 }}>{s.name} · {a.code}</div>
      {p.note && <div><div className="over quiet" style={{ fontSize: 10, marginBottom: 4 }}>Analysis · for you</div><p>{p.note}</p></div>}
      {p.feedback && <div><div className="over quiet" style={{ fontSize: 10, marginBottom: 4 }}>Feedback · for the student</div><p>{p.feedback}</p></div>}
      {parseCorrections(p.corrections).length > 0 && <div><div className="over quiet" style={{ fontSize: 10, marginBottom: 4 }}>Fix-it</div>{parseCorrections(p.corrections).map((c, i) => <div key={i} className="small"><s style={{ color: 'var(--accent)' }}>{c.wrote}</s> <b style={{ color: 'var(--green)' }}>{c.better}</b>{c.why && <span className="muted"> · {c.why}</span>}</div>)}</div>}
    </>
  ) : undefined
  const viewPages: ViewerPage[] = pages.map((pg) => ({ src: fileUrl(pg.filePath), label: `${s.name} · ${sideLabel(pg.page, pg.side)}`, sub: `${a.code} · ${a.title}`, pageId: pg.id, panel }))
  return (
    <section className="card" style={{ padding: 20, gap: 14 }}>
      <div className="between">
        <div><Link to={`/students/${s.code}`} className="serif" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{s.name}</Link> <span className="muted small" style={{ marginLeft: 8 }}>{s.code} · {p.sides} of {p.expected} sides{p.closedIncomplete ? ', filed incomplete' : ''} · last page {fmtDate(p.lastAt)}</span></div>
        <div className="row">
          {analysisOn && <button className="btn primary" disabled={busyJob} onClick={() => void analyseOne()} title={p.analysedAt ? `Analysed ${fmtDate(p.analysedAt)}; read it again` : 'Read these pages with Claude'}>{busyJob ? 'Analysing…' : p.analysedAt ? 'Analyse again' : 'Analyse'}</button>}
          {rubric.scoring !== 'none' && <button className={`btn ${anchor ? 'primary' : ''}`} onClick={() => setAnchoring((v) => !v)} title={anchor ? 'This packet is a scoring anchor; change or remove it' : 'Score this packet yourself and make it an example of that score for Claude'}>{anchor ? `Anchor · ${anchor.score}` : 'Make an anchor'}</button>}
          <a className="btn" href={`/api/packets/${a.code}/${s.code}/pdf?download=1`} title="This student's pages as one PDF">PDF</a>
          {p.feedback && <a className="btn" href={`/print/feedback/${a.code}/${s.code}`} target="_blank" rel="noreferrer" title="The note to this student, as a slip to print or save as PDF">Feedback slip</a>}
          <Link className="btn" to={`/compare?assignment=${a.code}&left=${s.code}`}>Compare</Link>
        </div>
      </div>
      <div className="thumbs" style={{ opacity: moving ? 0.6 : 1 }}>
        {pages.map((pg, i) => (
          <div key={pg.id} className="thumb">
            <ScanLink pages={viewPages} index={i} badge={pg.annotations}><img src={fileUrl(pg.thumbPath ?? pg.filePath)} alt={sideLabel(pg.page, pg.side)} /></ScanLink>
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
      {anchoring && <AnchorForm a={a} s={s} anchor={anchor} rubric={rubric} onDone={() => { setAnchoring(false); onSaved() }} />}
      {parseCriteria(p.criteria).length > 0 && (
        <div className="row" style={{ gap: 6 }}>
          <span className="over quiet" style={{ fontSize: 10, marginRight: 4 }}>Criteria</span>
          {parseCriteria(p.criteria).map((c) => <span key={c.criterion} className="chip" title={c.evidence ?? ''} style={{ background: c.met ? '#dff0e5' : '#f8dcd8' }}><b style={{ color: c.met ? 'var(--green)' : 'var(--accent)' }}>{c.met ? '✓' : '✗'}</b> {c.criterion}</span>)}
        </div>
      )}
      <ProgressRow raw={p.progress} />
      <div className="row" style={{ gap: 6 }}>
        <span className="over quiet" style={{ fontSize: 10, marginRight: 4 }}>Domains</span>
        {domains.map((d) => {
          const r = ratings.find((x) => x.domain === d)
          return editLevels ? (
            <label key={d} className="chip row" style={{ gap: 4 }}>{shortDomain(d)}
              <select value={levels[d] ?? ''} onChange={(e) => setLevels({ ...levels, [d]: Number(e.target.value) })} style={{ padding: '1px 4px', height: 'auto' }}><option value="">·</option>{[4, 3, 2, 1].map((l) => <option key={l} value={l}>{l} {LEVEL_NAME[l]}</option>)}</select>
            </label>
          ) : (
            <span key={d} className="chip" title={`${r?.note ?? 'not rated'}${r?.by === 'teacher' ? ` · your rating${r.claudeLevel != null ? `; Claude gave ${r.claudeLevel}` : ''}` : r ? ' · Claude\'s rating' : ''}`} style={{ background: r ? LEVEL_BG[r.level] : undefined, borderColor: r?.by === 'teacher' ? 'var(--ink2)' : undefined }}>{shortDomain(d)} <b>{r ? r.level : '·'}</b>{r?.by === 'teacher' && r.claudeLevel != null && r.claudeLevel !== r.level && <span className="muted"> vs {r.claudeLevel}</span>}</span>
          )
        })}
        {editLevels ? <><button className="btn" onClick={() => void saveDomains()} title="Saving records these as your ratings; Claude's stay beside them for the agreement check">Save</button><button className="btn" onClick={() => setEditLevels(false)}>Cancel</button></> : <button className="btn" onClick={() => setEditLevels(true)} title={ratings.some((r) => r.by === 'teacher') ? 'Change your ratings' : 'Rate the domains yourself; the comparison with Claude shows on the assignment'}>{ratings.length ? 'Edit' : 'Rate'}</button>}
      </div>
      <form className="col" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
        <div className="row" style={{ gap: 12 }}>
          <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>Score</span><input type="number" step="0.5" min={0} value={score} onChange={(e) => { setScore(e.target.value); setScoreTouched(true); setSaved(false) }} style={{ width: 70 }} title={p.scoreBy === 'teacher' ? `Your score${p.claudeScore != null ? `; Claude gave ${p.claudeScore}` : ''}` : p.scoreBy === 'claude' ? 'Claude\'s score. Type here to make it yours.' : undefined} /></label>
          {p.scoreBy === 'teacher' && p.claudeScore != null && p.claudeScore !== p.score && <span className="muted small" title="Claude's score is kept beside yours for the agreement check">Claude gave {p.claudeScore}</span>}
          <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>of</span><input type="number" step="1" min={1} value={of} onChange={(e) => { setOf(e.target.value); setSaved(false) }} style={{ width: 70 }} /></label>
          <button type="submit" className="btn primary" style={{ marginLeft: 'auto' }}>Save</button>
          {saved && <span className="muted small">Saved</span>}
          {err && <span className="err">{err}</span>}
        </div>
        <div className="grid2" style={{ gap: 16 }}>
          <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Analysis · for you</span>
            <textarea value={note} onChange={(e) => { setNote(e.target.value); setSaved(false) }} placeholder="What the work shows: paste Claude's answer for this student, or write your own." rows={Math.max(4, Math.min(14, Math.max(note.split('\n').length, feedback.split('\n').length) + 2))} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
          </label>
          <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Feedback · for {/\(([^)]+)\)\s*$/.exec(s.name)?.[1] ?? s.name}</span>
            <textarea value={feedback} onChange={(e) => { setFeedback(e.target.value); setSaved(false) }} placeholder="The note the student reads. Warm, specific, their own words quoted. Printed as a slip." rows={Math.max(4, Math.min(14, Math.max(note.split('\n').length, feedback.split('\n').length) + 2))} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
          </label>
        </div>
        <div className="grid2" style={{ gap: 16 }}>
          <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Fix-it table · one a line: you wrote → try — why</span>
            <textarea value={fixit} onChange={(e) => { setFixit(e.target.value); setSaved(false) }} placeholder={'did you became → did you become — after "did", the verb stays plain\nwere do you live → where do you live — "where" asks about a place'} rows={Math.max(3, Math.min(8, fixit.split('\n').length + 1))} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
          </label>
          <div className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>On the slip</span>
            {parseCorrectionLines(fixit).length ? (
              <table style={{ fontSize: 13 }}>
                <thead><tr><th>You wrote</th><th>Try</th><th>Why</th></tr></thead>
                <tbody>{parseCorrectionLines(fixit).map((c, i) => <tr key={i}><td style={{ color: 'var(--accent)', textDecoration: 'line-through' }}>{c.wrote}</td><td style={{ fontWeight: 600, color: 'var(--green)' }}>{c.better}</td><td className="muted">{c.why}</td></tr>)}</tbody>
              </table>
            ) : <div className="notice">No fix-it rows yet. The analysis fills them in, or type them on the left. Grades 1 and 2 print without the Why column.</div>}
          </div>
        </div>
      </form>
    </section>
  )
}

// The teacher's own score for this packet, kept as an example of that score. Every other packet is then scored against the anchors.
function AnchorForm({ a, s, anchor, rubric, onDone }: { a: Assignment; s: Row; anchor: Anchor | null; rubric: Rubric; onDone: () => void }) {
  const of = rubric.scoring === 'outOf' && rubric.scoreOf ? rubric.scoreOf : 4
  const [score, setScore] = useState(anchor ? String(anchor.score) : s.packet!.score != null ? String(s.packet!.score) : '')
  const [note, setNote] = useState(anchor?.note ?? '')
  const [err, setErr] = useState<string | null>(null)
  async function save() {
    try {
      setErr(null)
      if (score === '' || !Number.isFinite(Number(score))) return setErr('Give it a score first.')
      await put(`/api/packets/${a.code}/${s.code}/anchor`, { score: Number(score), scoreOf: of, note })
      onDone()
    } catch (e) { setErr((e as Error).message) }
  }
  async function remove() {
    try { await del(`/api/packets/${a.code}/${s.code}/anchor`); onDone() } catch (e) { setErr((e as Error).message) }
  }
  return (
    <form className="notice col" style={{ gap: 10, borderStyle: 'solid', borderColor: 'var(--accent)' }} onSubmit={(e) => { e.preventDefault(); void save() }}>
      <div className="over" style={{ fontSize: 10 }}>{anchor ? 'Scoring anchor' : 'Make this packet a scoring anchor'}</div>
      <div className="row" style={{ gap: 12, alignItems: 'flex-end' }}>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Your score</span>
          {rubric.scoring === 'holistic4' ? (
            <select value={score} onChange={(e) => setScore(e.target.value)} autoFocus><option value="">Choose</option>{[4, 3, 2, 1].map((l) => <option key={l} value={l}>{l} · {LEVEL_NAME[l]}</option>)}</select>
          ) : (
            <div className="row"><input type="number" step="0.5" min={0} max={of} value={score} onChange={(e) => setScore(e.target.value)} style={{ width: 80 }} autoFocus /><span className="muted small">of {of}</span></div>
          )}
        </label>
        <label className="col" style={{ gap: 4, flex: 1, minWidth: 260 }}><span className="over quiet" style={{ fontSize: 10 }}>What makes it a {score || '…'} · in your words, one line</span>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)} placeholder="every section done, two clear events, verbs mostly right" />
        </label>
        <button type="submit" className="btn primary">{anchor ? 'Save' : 'Make anchor'}</button>
        {anchor && <button type="button" className="btn" onClick={() => void remove()}>Remove anchor</button>}
        {err && <span className="err">{err}</span>}
      </div>
      <div className="muted small">The anchor's pages go to Claude with every other packet of {a.code}, under your score and note, and the rest are scored by comparison. Two or three anchors across the range work best; the pages are cached across the run so they cost little extra.</div>
    </form>
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


function EditForm({ a, printed, onDone }: { a: Assignment; printed: Array<{ page: number; side: Side }>; onDone: () => void }) {
  const [f, setF] = useState({ title: a.title, klass: a.klass, grade: a.grade == null ? '' : String(a.grade), assignedOn: a.assignedOn ?? '', sheets: a.sheets, twoSided: !!a.twoSided, sides: a.sides == null ? '' : String(a.sides), tags: a.tags })
  // which printed sides come back to be scanned; all of them unless some were unticked (a reading page stays with the student)
  const [back, setBack] = useState<Set<string>>(() => new Set((parseExpect(a.expect).length ? parseExpect(a.expect) : printed).map((e) => `${e.page}${e.side}`)))
  const [err, setErr] = useState<string | null>(null)
  const { data: classes } = useFetch<{ classes: string[] }>('/api/students')
  const max = f.sheets * (f.twoSided ? 2 : 1)
  // the sides as the form now has them: sheets × sides, capped by "sides in all"
  const sidesNow: Array<{ page: number; side: Side }> = []
  for (let p = 1; p <= Math.max(1, f.sheets); p++) { sidesNow.push({ page: p, side: 'a' }); if (f.twoSided) sidesNow.push({ page: p, side: 'b' }) }
  const cap = f.sides === '' ? sidesNow.length : Number(f.sides)
  const choosable = cap > 0 && cap < sidesNow.length ? sidesNow.slice(0, cap) : sidesNow
  const allBack = choosable.every((e) => back.has(`${e.page}${e.side}`))
  async function save() {
    try {
      setErr(null)
      const expect = allBack ? null : choosable.filter((e) => back.has(`${e.page}${e.side}`)).map((e) => `${e.page}${e.side}`)
      if (expect && expect.length === 0) throw new Error('Tick at least one side that comes back.')
      await fetch(`/api/assignments/${a.code}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...f, grade: f.grade === '' ? null : Number(f.grade), sides: f.sides === '' ? null : Number(f.sides), expect: formatExpect(expect) }) }).then(async (r) => { if (!r.ok) throw new Error((await r.json()).error ?? r.statusText) })
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
      {choosable.length > 1 && (
        <div className="col" style={{ gap: 4 }} title="Untick a side that stays with the student, such as a reading page. The scanner then waits only for the ticked ones, and a packet is complete when they are in.">
          <span className="over quiet" style={{ fontSize: 10 }}>Comes back to be scanned</span>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap' }}>
            {choosable.map((e) => { const k = `${e.page}${e.side}`; return <label key={k} className="row" style={{ gap: 4 }}><input type="checkbox" checked={back.has(k)} onChange={(ev) => setBack((prev) => { const n = new Set(prev); if (ev.target.checked) n.add(k); else n.delete(k); return n })} /> {sideLabel(e.page, e.side)}</label> })}
          </div>
          {!allBack && <div className="muted small">The other sides are kept if they are scanned, but not waited for.</div>}
        </div>
      )}
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
  const anyCriteria = rows.some((r) => parseCriteria(r.packet!.criteria).length)
  if (!ratings.length && !anyCriteria) return <div className="notice">No domain ratings yet. Analyse the assignment, paste Claude's answer, or click a student and Rate.</div>
  return (
    <div style={{ overflowX: 'auto' }}>
      <table>
        <thead><tr><th>Student</th><th style={{ textAlign: 'center' }}>Score</th>{anyCriteria && <th style={{ textAlign: 'center' }}>Criteria</th>}{domains.map((d) => <th key={d} style={{ textAlign: 'center' }} title={d}>{shortDomain(d)}</th>)}</tr></thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.code} style={{ cursor: 'pointer' }} onClick={() => onPick(r.code)}>
              <td style={{ fontWeight: 600 }}>{r.name}</td>
              <td style={{ textAlign: 'center' }}>{r.packet!.score != null ? `${r.packet!.score}${r.packet!.scoreOf != null ? `/${r.packet!.scoreOf}` : ''}` : <span className="muted">—</span>}</td>
              {anyCriteria && <td style={{ textAlign: 'center' }} title={parseCriteria(r.packet!.criteria).map((c) => `${c.met ? '✓' : '✗'} ${c.criterion}`).join('\n')}>{parseCriteria(r.packet!.criteria).length ? `${parseCriteria(r.packet!.criteria).filter((c) => c.met).length}/${parseCriteria(r.packet!.criteria).length}` : <span className="muted">·</span>}</td>}
              {domains.map((d) => { const x = level(r.code, d); return <td key={d} style={{ textAlign: 'center', background: x ? LEVEL_BG[x.level] : undefined }} title={x?.note ?? ''}>{x ? x.level : <span className="muted">·</span>}</td> })}
            </tr>
          ))}
        </tbody>
        <tfoot><tr><td style={{ fontWeight: 600, borderTop: '2px solid var(--line)' }}>Class average</td><td style={{ borderTop: '2px solid var(--line)' }}></td>{anyCriteria && <td style={{ borderTop: '2px solid var(--line)' }}></td>}{domains.map((d) => <td key={d} style={{ textAlign: 'center', fontWeight: 600, borderTop: '2px solid var(--line)' }}>{avg(d)}</td>)}</tr></tfoot>
      </table>
    </div>
  )
}


function RubricCard({ a, rubric, allDomains, onSaved }: { a: Assignment; rubric: Rubric; allDomains: string[]; onSaved: () => void }) {
  const [open, setOpen] = useState(false)
  const [r, setR] = useState<Rubric>(rubric)
  const [criteria, setCriteria] = useState(rubric.criteria.join('\n'))
  const [focus, setFocus] = useState(rubric.focus.join(', '))
  const [saved, setSaved] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const chosen = r.domains ?? allDomains
  const summary = [
    rubric.criteria.length ? `${rubric.criteria.length} criteria` : rubric.propose ? 'criteria from the worksheet' : 'no criteria',
    `${(rubric.domains ?? allDomains).length} of ${allDomains.length} domains`,
    rubric.focus.length ? `focus: ${rubric.focus.join(', ')}` : null,
    { warm: 'warm', plain: 'plain', playful: 'playful' }[rubric.tone] + ', ' + { short: 'short', standard: 'standard', full: 'full' }[rubric.length] + ' notes',
    rubric.scoring === 'none' ? 'no score' : rubric.scoring === 'outOf' ? `score out of ${rubric.scoreOf}` : 'score 1 to 4',
  ].filter(Boolean).join(' · ')
  async function save() {
    try {
      setErr(null)
      const body = { ...r, criteria: criteria.split('\n').map((x) => x.trim()).filter(Boolean), focus: focus.split(',').map((x) => x.trim()).filter(Boolean), domains: r.domains && r.domains.length === allDomains.length ? null : r.domains }
      await fetch(`/api/assignments/${a.code}/rubric`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(async (x) => { if (!x.ok) throw new Error((await x.json()).error ?? x.statusText) })
      setSaved(true)
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  const toggleDomain = (d: string) => setR({ ...r, domains: chosen.includes(d) ? chosen.filter((x) => x !== d) : allDomains.filter((x) => x === d || chosen.includes(x)) })
  const ta = { width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' as const }
  return (
    <section className="card" style={{ gap: 12, padding: '14px 18px' }} data-testid="rubric">
      <div className="between">
        <div><span className="over">Rubric</span> <span className="muted small" style={{ marginLeft: 10 }}>{summary}</span></div>
        <button className="btn" onClick={() => setOpen((v) => !v)}>{open ? 'Close' : 'Edit rubric'}</button>
      </div>
      {!open && <div className="muted small">What the analysis checks and how it writes, for this assignment. Used by Analyse with Claude and by Copy prompt.</div>}
      {open && (
        <form className="col" style={{ gap: 14 }} onSubmit={(e) => { e.preventDefault(); void save() }}>
          <div className="grid2" style={{ gap: 16 }}>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Success criteria · one a line, checked for every student</span>
              <textarea value={criteria} onChange={(e) => { setCriteria(e.target.value); setSaved(false) }} rows={5} placeholder={'all four sections filled\none now-versus-future contrast\na wish for future me\na sign-off'} style={ta} />
              <label className="row small"><input type="checkbox" checked={r.propose} onChange={(e) => setR({ ...r, propose: e.target.checked })} /> If this is empty, work out criteria from the worksheet itself</label>
            </label>
            <div className="col" style={{ gap: 8 }}>
              <span className="over quiet" style={{ fontSize: 10 }}>Domains rated for this assignment · and what a 4 looks like here</span>
              {allDomains.map((d) => (
                <div key={d} className="row" style={{ gap: 8 }}>
                  <label className="row small" style={{ width: 200 }}><input type="checkbox" checked={chosen.includes(d)} onChange={() => toggleDomain(d)} /> {d.split(':')[0].trim()}</label>
                  <input type="text" value={r.domainNotes[d] ?? ''} disabled={!chosen.includes(d)} onChange={(e) => setR({ ...r, domainNotes: { ...r.domainNotes, [d]: e.target.value } })} placeholder="optional: what earns a 4" style={{ flex: 1, fontSize: 13 }} />
                </div>
              ))}
            </div>
          </div>
          <div className="row" style={{ gap: 14 }}>
            <label className="col" style={{ gap: 4, flex: 1, minWidth: 240 }}><span className="over quiet" style={{ fontSize: 10 }}>Focus · what you have been teaching, comma separated</span><input type="text" value={focus} onChange={(e) => { setFocus(e.target.value); setSaved(false) }} placeholder="past tense, question marks, because sentences" /></label>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Tone</span><select value={r.tone} onChange={(e) => setR({ ...r, tone: e.target.value as Rubric['tone'] })}><option value="warm">Warm</option><option value="plain">Plain</option><option value="playful">Playful</option></select></label>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Student note</span><select value={r.length} onChange={(e) => setR({ ...r, length: e.target.value as Rubric['length'] })}><option value="short">Short · grades 1 to 2</option><option value="standard">Standard</option><option value="full">Full · grades 4 to 5</option></select></label>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Fix-it rows</span><input type="number" min={0} max={10} value={r.fixitMax} onChange={(e) => setR({ ...r, fixitMax: Number(e.target.value) })} style={{ width: 70 }} /></label>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Score</span><select value={r.scoring} onChange={(e) => setR({ ...r, scoring: e.target.value as Rubric['scoring'] })}><option value="holistic4">1 to 4, whole task</option><option value="outOf">Out of…</option><option value="none">No score</option></select></label>
            {r.scoring === 'outOf' && <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Out of</span><input type="number" min={1} max={100} value={r.scoreOf ?? ''} onChange={(e) => setR({ ...r, scoreOf: Number(e.target.value) || null })} style={{ width: 70 }} /></label>}
          </div>
          <div className="muted small">The note to the student never mentions the score, whatever is chosen here.</div>
          <div className="row"><button type="submit" className="btn primary">Save rubric</button>{saved && <span className="muted small">Saved</span>}{err && <span className="err">{err}</span>}</div>
        </form>
      )}
    </section>
  )
}
