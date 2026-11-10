import { useEffect, useMemo, useState } from 'react'
import { useViewer } from '../components/Viewer'
import { Link } from 'react-router-dom'
import { get, post, useFetch, ago, fmtTime, fileUrl, sideLabel, type Assignment, type Guess, type Page, type ReviewItem, type Student } from '../api'

interface Data { items: ReviewItem[]; pages: Record<string, Page>; assignments: Assignment[]; filedThisWeek: number; autoThisWeek: number }

export default function Review() {
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<Data>('/api/review', bump)
  const [idx, setIdx] = useState(0)
  const [pick, setPick] = useState(1)
  const [other, setOther] = useState({ student: '', assignment: '', page: '1', side: 'a' })
  const [matches, setMatches] = useState<Student[]>([])
  const [err, setErr] = useState<string | null>(null)
  const [rotate, setRotate] = useState(0)
  const [zoom, setZoom] = useState(false)
  const { open: openViewer } = useViewer()

  const items = data?.items ?? []
  const item = items[Math.min(idx, Math.max(0, items.length - 1))]
  const page = item?.pageId ? data?.pages[item.pageId] : undefined
  const guess: Guess | undefined = item?.guesses[pick - 1]
  const otherPick = item ? pick === item.guesses.length : false

  useEffect(() => {
    setPick(1)
    setErr(null)
    setRotate(0)
    if (item?.assignment) setOther((o) => ({ ...o, assignment: item.assignment! }))
  }, [item?.pageId, item?.student, item?.assignment])

  useEffect(() => {
    if (!other.student || /^[A-Z0-9-]{3,12}$/i.test(other.student.trim()) && matches.some((m) => m.code === other.student.trim().toUpperCase())) return setMatches([])
    if (!other.student) return setMatches([])
    const t = setTimeout(() => get<Student[]>(`/api/students/search?q=${encodeURIComponent(other.student)}`).then(setMatches).catch(() => setMatches([])), 150)
    return () => clearTimeout(t)
  }, [other.student])

  const target = useMemo(() => {
    if (!item) return null
    if (otherPick) return { student: other.student.toUpperCase(), assignment: other.assignment.toUpperCase(), page: Number(other.page), side: other.side }
    if (!guess?.student || !guess.assignment) return null
    return { student: guess.student, assignment: guess.assignment, page: guess.page ?? Number(other.page), side: guess.side ?? other.side }
  }, [item, guess, other, otherPick])

  async function fileIt(allowDuplicate = false) {
    if (!item) return
    try {
      setErr(null)
      if (item.kind === 'packet') {
        await post(`/api/review/packet/${item.assignment}/${item.student}/close`, {})
      } else {
        if (!target?.student || !target.assignment || !target.page) return setErr('Pick a student, an assignment and a side first.')
        await post(`/api/review/${item.pageId}/file`, { ...target, allowDuplicate })
      }
      setBump((b) => b + 1)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function skipAll() {
    const pageItems = items.filter((i) => i.kind === 'page').length
    if (!pageItems) return
    if (!window.confirm(`Skip all ${pageItems} pages waiting in review? They stay on disk under data/holding and are marked skipped; nothing is deleted.`)) return
    try {
      await post('/api/review/skip-all', {})
      setIdx(0)
      setBump((b) => b + 1)
    } catch (e) {
      setErr((e as Error).message)
    }
  }
  async function skip(notWork = false) {
    if (!item || item.kind !== 'page') return
    try {
      await post(`/api/review/${item.pageId}/skip`, { notWork })
      setBump((b) => b + 1)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
        if (e.key === 'Enter' && t.tagName === 'INPUT') { e.preventDefault(); void fileIt() }
        return
      }
      if (e.key === 'j' || e.key === 'J') setIdx((i) => Math.min(i + 1, items.length - 1))
      else if (e.key === 'k' || e.key === 'K') setIdx((i) => Math.max(i - 1, 0))
      else if (/^[1-9]$/.test(e.key) && item && Number(e.key) <= item.guesses.length) setPick(Number(e.key))
      else if (e.key === 'Enter') { e.preventDefault(); void fileIt() }
      else if (e.key === 'x' || e.key === 'X') void skip()
      else if (e.key === 'r' || e.key === 'R') setRotate((r) => (r + 90) % 360)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>

  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over">Needs you</div>
        <h1 className="serif title">Review</h1>
        <p className="lede">{items.length === 0 ? 'Nothing waiting. Every page the scanner saw found its place.' : `${items.length === 1 ? 'One page' : `${items.length} items`} the scanner could not place on its own. One at a time, keyboard first.`}</p>
        <div className="muted small row" style={{ gap: 16 }}>
          <span><kbd className="key">J</kbd><kbd className="key">K</kbd> next, previous</span>
          <span><kbd className="key">1</kbd> to <kbd className="key">3</kbd> pick a guess</span>
          <span><kbd className="key">Enter</kbd> file it</span>
          <span><kbd className="key">X</kbd> skip</span>
          <span><kbd className="key">R</kbd> rotate</span>
        </div>
      </section>

      {items.filter((i) => i.kind === 'page' && i.pageId && !data.pages[i.pageId]?.decoded).length > 3 && (
        <div className="notice row" style={{ justifyContent: 'space-between' }}>
          <span>{items.filter((i) => i.kind === 'page' && i.pageId && !data.pages[i.pageId]?.decoded).length} pages here have no code. If they are one assignment scanned in order, File a stack names them all at once: one student per packet, pre-filled from the roster.</span>
          <Link className="btn primary" to="/review/stack">File a stack</Link>
        </div>
      )}
      {item && (
        <section className="grid2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 32 }}>
          <div className="col">
            <div className="between">
              <div className="over">Item {idx + 1} of {items.length}</div>
              <div className="muted small">scanned {fmtTime(item.scannedAt)}{page && ` · ${page.sourceName}`}</div>
            </div>
            {page ? (
              <div style={{ overflow: 'auto', maxHeight: zoom ? 'none' : 720 }}>
                <button type="button" className="scanlink" onClick={() => openViewer([{ src: fileUrl(page.filePath), label: page.sourceName, sub: item.problem }])} title="Open large. Wheel to zoom, drag to move, Esc to close." style={{ width: zoom ? '160%' : '100%' }}>
                  <img className="scan" src={fileUrl(page.filePath)} alt="Page in review" style={{ transform: `rotate(${rotate}deg)` }} />
                </button>
              </div>
            ) : (
              <div className="notice">This is a packet, not a page: {item.student} on {item.assignment}. The pages that did arrive are on <Link to={`/assignments/${item.assignment}`}>the assignment</Link>.</div>
            )}
            {page && (
              <div className="row">
                <span className="muted small">{page.decoded ? `Code read: ${page.decoded}` : 'No code could be read on the page.'}</span>
                <button className="btn" style={{ marginLeft: 'auto' }} onClick={() => setRotate((r) => (r + 90) % 360)}>Rotate</button>
                <button className="btn" onClick={() => setZoom((z) => !z)}>{zoom ? 'Fit' : 'Zoom'}</button>
                <button className="btn" onClick={() => openViewer([{ src: fileUrl(page.filePath), label: page.sourceName, sub: item.problem }])}>Open large</button>
              </div>
            )}
          </div>

          <div className="col" style={{ gap: 16 }}>
            <div className="col" style={{ gap: 6 }}>
              <div className="over">Why it is here</div>
              <p style={{ margin: 0 }}>{item.problem}.</p>
            </div>
            <div className="col" style={{ gap: 8 }}>
              <div className="over">Best guesses</div>
              {item.guesses.map((g) => (
                <button key={g.rank} className={`guess ${pick === g.rank ? 'on' : ''}`} onClick={() => setPick(g.rank)}>
                  <span className="n">{g.rank}</span>
                  <span className="col" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{g.student ? `${g.studentName} · ${g.assignment}${g.page ? ` · ${sideLabel(g.page, g.side)}` : ''}` : 'Someone else'}</span>
                    <span className="muted small">{g.why}</span>
                  </span>
                </button>
              ))}
            </div>
            {item.kind === 'page' && (otherPick || !guess?.page) && (
              <div className="col" style={{ gap: 8 }}>
                {otherPick && (
                  <div className="row">
                    <label className="col" style={{ gap: 4, flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Student name or code</span>
                      <input type="text" value={other.student} onChange={(e) => setOther({ ...other, student: e.target.value })} placeholder="Minji or S07" />
                      {matches.length > 0 && (
                        <div className="card" style={{ padding: 6, gap: 2 }}>
                          {matches.map((m) => <button key={m.code} className="tab" style={{ textAlign: 'left', padding: '4px 6px' }} onClick={() => { setOther({ ...other, student: m.code }); setMatches([]) }}>{m.name} · {m.code} · {m.klass}</button>)}
                        </div>
                      )}
                    </label>
                    <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Assignment</span>
                      <select value={other.assignment} onChange={(e) => setOther({ ...other, assignment: e.target.value })}><option value="">Choose</option>{data.assignments.map((a) => <option key={a.code} value={a.code}>{a.code}</option>)}</select>
                    </label>
                  </div>
                )}
                <div className="row">
                  <span className="over quiet" style={{ fontSize: 10 }}>Page and side</span>
                  {[1, 2, 3].flatMap((p) => (['a', 'b'] as const).map((s) => (
                    <button key={`${p}${s}`} className={`chip ${other.page === String(p) && other.side === s ? 'on' : ''}`} onClick={() => setOther({ ...other, page: String(p), side: s })}>{sideLabel(p, s)}</button>
                  )))}
                </div>
              </div>
            )}
            {err && <p className="err" style={{ margin: 0 }}>{err}{/already has/.test(err) && <> · <button className="btn" onClick={() => void fileIt(true)}>Replace the existing scan</button></>}</p>}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn primary" onClick={() => void fileIt()}>
                {item.kind === 'packet' ? `File as ${item.guesses[0]?.why.replace(/^File as /, '').replace(/\.$/, '')}` : target?.student ? `File as ${target.student}${target.assignment ? ` · ${target.assignment}` : ''} · ${sideLabel(target.page, target.side)}` : 'File'} <span style={{ opacity: 0.7, marginLeft: 6 }}>Enter</span>
              </button>
              {item.kind === 'page' && <><button className="btn" onClick={() => void skip()}>Skip</button><button className="btn" onClick={() => void skip(true)}>Not student work</button></>}
            </div>
          </div>
        </section>
      )}

      <section className="col sep">
        <div className="between">
          <div className="over">The queue</div>
          <div className="row">
            {items.filter((i) => i.kind === 'page' && i.pageId && !data.pages[i.pageId]?.decoded).length > 1 && <Link className="btn primary" to="/review/stack" title="Pages scanned in order without codes: one assignment, cut into packets, a student each">File a stack</Link>}
            {items.some((i) => i.kind === 'page') && <button className="btn" onClick={() => void skipAll()}>Skip everything in the queue</button>}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th style={{ width: 40 }}></th><th style={{ width: 100 }}>Scanned</th><th>Problem</th><th>Best guess</th><th style={{ width: 90 }}>Waiting</th></tr></thead>
            <tbody>
              {items.map((it, i) => (
                <tr key={`${it.kind}-${it.pageId ?? `${it.student}-${it.assignment}`}`} onClick={() => setIdx(i)} style={{ cursor: 'pointer', background: i === idx ? 'var(--paper)' : undefined }}>
                  <td className="serif" style={{ fontSize: 18, color: 'var(--accent)' }}>{i + 1}</td>
                  <td className="muted">{fmtTime(it.scannedAt)}</td>
                  <td>{it.problem}</td>
                  <td>{it.guesses[0]?.student ? `${it.guesses[0].studentName} · ${it.guesses[0].assignment}${it.guesses[0].page ? ` · ${sideLabel(it.guesses[0].page, it.guesses[0].side)}` : ''}` : <span className="muted">Needs a look</span>}</td>
                  <td className="muted">{ago(it.waitingSince)}</td>
                </tr>
              ))}
              {items.length === 0 && <tr><td colSpan={5} className="muted">Empty.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="muted small">Filed from review this week: {data.filedThisWeek}. Pages the scanner placed on its own: {data.autoThisWeek}.</div>
      </section>
    </main>
  )
}
