import { useEffect, useMemo, useRef, useState } from 'react'
import { useViewer } from '../components/Viewer'
import { Link } from 'react-router-dom'
import { get, post, useFetch, ago, fmtTime, fileUrl, sideLabel, type Assignment, type Guess, type Page, type ReviewItem, type Student } from '../api'
import { parseLooseCode, sidesOf } from '../../../shared/codeInput'
import type { Side } from '../../../shared/types'

interface Data { items: ReviewItem[]; pages: Record<string, Page>; assignments: Assignment[]; filedThisWeek: number; autoThisWeek: number }

// What the typed label resolves to. "S07 W23 2 back" is read whole; "Minji W23
// 2 back" needs the roster to turn the name into a code, so the name is handed
// back for a search and the rest waits until exactly one student matches.
export interface Typed { name?: string; student?: string; assignment?: string; page?: number; side?: Side }
export function readTyped(text: string, matches: Student[]): Typed {
  const ref = parseLooseCode(text)
  if (ref) return { student: ref.student, assignment: ref.assignment, page: ref.page, side: ref.side }
  const tokens = text.trim().split(/[\s:|·,/]+/).filter(Boolean)
  let i = 0
  while (i < tokens.length && !/\d/.test(tokens[i])) i++
  const name = tokens.slice(0, i).join(' ')
  if (!name) return {}
  const code = matches.length === 1 ? matches[0].code : null
  if (!code) return { name }
  const rest = tokens.slice(i)
  if (!rest.length) return { name, student: code }
  const r2 = parseLooseCode([code, ...rest].join(' '))
  return r2 ? { name, student: code, assignment: r2.assignment, page: r2.page, side: r2.side } : { name, student: code }
}

// Where a page came from, for the screen: the PDF and page number when it was
// rendered from one, else the file the scanner saved.
export function originLabel(p: Pick<Page, 'origin' | 'originPage' | 'sourceName'>): string {
  if (p.origin) return `${p.origin.split('/').pop()}, page ${p.originPage ?? '?'}`
  return p.sourceName
}

const FALLBACK_SIDES: Array<{ page: number; side: Side }> = [1, 2, 3].flatMap((p) => (['a', 'b'] as Side[]).map((s) => ({ page: p, side: s })))

export default function Review() {
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<Data>('/api/review', bump)
  const [idx, setIdx] = useState(0)
  const [pick, setPick] = useState(1)
  const [other, setOther] = useState({ student: '', assignment: '', page: '1', side: 'a' })
  const [typed, setTyped] = useState('')
  const [matches, setMatches] = useState<Student[]>([])
  const [have, setHave] = useState<Set<string>>(new Set())
  const [err, setErr] = useState<string | null>(null)
  const [rotate, setRotate] = useState(0)
  const [zoom, setZoom] = useState(false)
  const typedRef = useRef<HTMLInputElement>(null)
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
    setTyped('')
    setMatches([])
    setOther((o) => ({ ...o, student: '', assignment: item?.assignment ?? o.assignment }))
  }, [item?.pageId, item?.student, item?.assignment])

  // A name at the front of what was typed is looked up on the roster.
  const typedName = useMemo(() => readTyped(typed, []).name ?? '', [typed])
  useEffect(() => {
    if (!typedName) return setMatches([])
    const t = setTimeout(() => get<Student[]>(`/api/students/search?q=${encodeURIComponent(typedName)}`).then(setMatches).catch(() => setMatches([])), 150)
    return () => clearTimeout(t)
  }, [typedName])

  // What was typed fills the target; the chips and the assignment list can still change it after.
  useEffect(() => {
    if (!typed.trim() || !item) return
    const t = readTyped(typed, matches)
    setPick(item.guesses.length)
    setOther((o) => ({
      student: t.student ?? '',
      assignment: t.assignment ?? o.assignment,
      page: t.page ? String(t.page) : o.page,
      side: t.side ?? o.side,
    }))
  }, [typed, matches, item?.guesses.length])

  const target = useMemo(() => {
    if (!item) return null
    if (otherPick) return { student: other.student.toUpperCase(), assignment: other.assignment.toUpperCase(), page: Number(other.page), side: other.side }
    if (!guess?.student || !guess.assignment) return null
    return { student: guess.student, assignment: guess.assignment, page: guess.page ?? Number(other.page), side: guess.side ?? other.side }
  }, [item, guess, other, otherPick])

  const targetAssignment = useMemo(() => data?.assignments.find((a) => a.code === target?.assignment), [data, target?.assignment])
  const sides = targetAssignment ? sidesOf(targetAssignment) : FALLBACK_SIDES
  const targetStudent = useMemo(() => {
    if (!target?.student) return null
    const m = matches.find((s) => s.code === target.student)
    if (m) return m
    const g = item?.guesses.find((g) => g.student === target.student)
    return g ? { code: g.student!, name: g.studentName ?? g.student! } : null
  }, [target?.student, matches, item])

  // Which sides this student already has for this assignment, so the chips can say so.
  useEffect(() => {
    if (!target?.student || !target.assignment || !data?.assignments.some((a) => a.code === target.assignment)) return setHave(new Set())
    let alive = true
    get<Page[]>(`/api/packets/${target.assignment}/${target.student}/pages`)
      .then((ps) => alive && setHave(new Set(ps.map((p) => `${p.page}${p.side}`))))
      .catch(() => alive && setHave(new Set()))
    return () => { alive = false }
  }, [target?.student, target?.assignment, data, bump])

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
        if (e.key === 'Escape') (t as HTMLInputElement).blur()
        return
      }
      if (e.key === 'j' || e.key === 'J') setIdx((i) => Math.min(i + 1, items.length - 1))
      else if (e.key === 'k' || e.key === 'K') setIdx((i) => Math.max(i - 1, 0))
      else if (/^[1-9]$/.test(e.key) && item && Number(e.key) <= item.guesses.length) setPick(Number(e.key))
      else if (e.key === 'Enter') { e.preventDefault(); void fileIt() }
      else if (e.key === 'x' || e.key === 'X') void skip()
      else if (e.key === 'r' || e.key === 'R') setRotate((r) => (r + 90) % 360)
      else if (e.key === 't' || e.key === 'T') { e.preventDefault(); typedRef.current?.focus() }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>

  const uncoded = items.filter((i) => i.kind === 'page' && i.pageId && !data.pages[i.pageId]?.decoded).length
  const readAs = target?.student && target.assignment && targetAssignment
    ? `${targetStudent?.name ?? target.student} · ${target.assignment} · ${sideLabel(target.page, target.side)}`
    : null

  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over">Needs you</div>
        <h1 className="serif title">Review</h1>
        <p className="lede">{items.length === 0 ? 'Nothing waiting. Every page the scanner saw found its place.' : `${items.length === 1 ? 'One page' : `${items.length} items`} the scanner could not place on its own. One at a time, keyboard first.`}</p>
        <div className="muted small row" style={{ gap: 16 }}>
          <span><kbd className="key">J</kbd><kbd className="key">K</kbd> next, previous</span>
          <span><kbd className="key">1</kbd> to <kbd className="key">3</kbd> pick a guess</span>
          <span><kbd className="key">T</kbd> type the label</span>
          <span><kbd className="key">Enter</kbd> file it</span>
          <span><kbd className="key">X</kbd> skip</span>
          <span><kbd className="key">R</kbd> rotate</span>
        </div>
      </section>

      {uncoded > 3 && (
        <div className="notice row" style={{ justifyContent: 'space-between' }}>
          <span>{uncoded} pages here have no code. If they are one assignment scanned in order, File a stack names them all at once: one student per packet, pre-filled from the roster.</span>
          <Link className="btn primary" to="/review/stack">File a stack</Link>
        </div>
      )}
      {item && (
        <section className="grid2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 32 }}>
          <div className="col">
            <div className="between">
              <div className="over">Item {idx + 1} of {items.length}</div>
              <div className="muted small">
                scanned {fmtTime(item.scannedAt)}
                {page && (page.origin
                  ? <> · from <a href={fileUrl(page.origin)} target="_blank" rel="noreferrer" title="Open the PDF the scanner saved, kept as it came">{originLabel(page)}</a></>
                  : <> · {page.sourceName}</>)}
              </div>
            </div>
            {page ? (
              <div style={{ overflow: 'auto', maxHeight: zoom ? 'none' : 720 }}>
                <button type="button" className="scanlink" onClick={() => openViewer([{ src: fileUrl(page.filePath), label: page.sourceName, sub: item.problem, pageId: page.id }])} title="Open large. Wheel to zoom, drag to move, Esc to close." style={{ width: zoom ? '160%' : '100%' }}>
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
                <button className="btn" onClick={() => openViewer([{ src: fileUrl(page.filePath), label: page.sourceName, sub: item.problem, pageId: page.id }])}>Open large</button>
              </div>
            )}
          </div>

          <div className="col" style={{ gap: 16 }}>
            <div className="col" style={{ gap: 6 }}>
              <div className="over">Why it is here</div>
              <p style={{ margin: 0 }}>{item.problem}.</p>
            </div>
            {item.kind === 'page' && (
              <label className="col" style={{ gap: 4 }}>
                <span className="over">Type what the label says</span>
                <input ref={typedRef} type="text" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder="S07 W23 2 back · or a name: Minji W23 2 back" autoComplete="off" style={{ fontSize: 15 }} />
                {typed.trim() && (
                  <span className="muted small">
                    {readAs ? <>Read as <b>{readAs}</b>. Enter files it.</>
                      : matches.length > 1 ? 'Which one?'
                      : typedName && matches.length === 0 ? `No student called ${typedName}.`
                      : target?.student && !target.assignment ? 'Now the assignment code, or choose it below.'
                      : 'Student code, assignment code, then the side: S07 W23 2 back.'}
                  </span>
                )}
                {matches.length > 1 && (
                  <div className="card" style={{ padding: 6, gap: 2 }}>
                    {matches.map((m) => <button key={m.code} type="button" className="tab" style={{ textAlign: 'left', padding: '4px 6px' }} onClick={() => { const rest = typed.trim().split(/[\s:|·,/]+/).filter((t) => /\d/.test(t)); setTyped([m.code, ...rest].join(' ')); setMatches([m]) }}>{m.name} · {m.code} · {m.klass}</button>)}
                  </div>
                )}
              </label>
            )}
            <div className="col" style={{ gap: 8 }}>
              <div className="over">Best guesses</div>
              {item.guesses.map((g) => (
                <button key={g.rank} className={`guess ${pick === g.rank ? 'on' : ''}`} onClick={() => setPick(g.rank)}>
                  <span className="n">{g.rank}</span>
                  <span className="col" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{g.student ? `${g.studentName} · ${g.assignment}${g.page ? ` · ${sideLabel(g.page, g.side)}` : ''}` : typed.trim() && target?.student ? `${targetStudent?.name ?? target.student}${target.assignment ? ` · ${target.assignment}` : ''}` : 'Someone else'}</span>
                    <span className="muted small">{g.student ? g.why : 'Type what the label says above, or choose below.'}</span>
                  </span>
                </button>
              ))}
            </div>
            {item.kind === 'page' && (otherPick || !guess?.page) && (
              <div className="col" style={{ gap: 8 }}>
                {otherPick && (
                  <div className="row">
                    <label className="col" style={{ gap: 4, flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Student code</span>
                      <input type="text" value={other.student} onChange={(e) => setOther({ ...other, student: e.target.value })} placeholder="S07" />
                    </label>
                    <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Assignment</span>
                      <select value={other.assignment} onChange={(e) => setOther({ ...other, assignment: e.target.value })}><option value="">Choose</option>{data.assignments.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.title}</option>)}</select>
                    </label>
                  </div>
                )}
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <span className="over quiet" style={{ fontSize: 10 }}>Page and side</span>
                  {sides.map(({ page: p, side: s }) => {
                    const on = other.page === String(p) && other.side === s
                    const filed = have.has(`${p}${s}`)
                    return (
                      <button key={`${p}${s}`} className={`chip ${on ? 'on' : ''}`} onClick={() => setOther({ ...other, page: String(p), side: s })} title={filed ? `${targetStudent?.name ?? target?.student} already has this side filed; filing here replaces it` : undefined} style={filed && !on ? { opacity: 0.55, textDecoration: 'line-through' } : undefined}>
                        {sideLabel(p, s)}
                      </button>
                    )
                  })}
                  {have.size > 0 && <span className="muted small">crossed out: already filed</span>}
                </div>
              </div>
            )}
            {err && <p className="err" style={{ margin: 0 }}>{err}{/already has/.test(err) && <> · <button className="btn" onClick={() => void fileIt(true)}>Replace the existing scan</button></>}</p>}
            <div className="row" style={{ gap: 10 }}>
              <button className="btn primary" onClick={() => void fileIt()}>
                {item.kind === 'packet' ? `File as ${item.guesses[0]?.why.replace(/^File as /, '').replace(/\.$/, '')}` : target?.student ? `File as ${targetStudent?.name ?? target.student}${target.assignment ? ` · ${target.assignment}` : ''} · ${sideLabel(target.page, target.side)}` : 'File'} <span style={{ opacity: 0.7, marginLeft: 6 }}>Enter</span>
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
            {uncoded > 1 && <Link className="btn primary" to="/review/stack" title="Pages scanned in order without codes: one assignment, cut into packets, a student each">File a stack</Link>}
            {items.some((i) => i.kind === 'page') && <button className="btn" onClick={() => void skipAll()}>Skip everything in the queue</button>}
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th style={{ width: 40 }}></th><th style={{ width: 100 }}>Scanned</th><th>From</th><th>Problem</th><th>Best guess</th><th style={{ width: 90 }}>Waiting</th></tr></thead>
            <tbody>
              {items.map((it, i) => {
                const p = it.pageId ? data.pages[it.pageId] : undefined
                return (
                  <tr key={`${it.kind}-${it.pageId ?? `${it.student}-${it.assignment}`}`} onClick={() => setIdx(i)} style={{ cursor: 'pointer', background: i === idx ? 'var(--paper)' : undefined }}>
                    <td className="serif" style={{ fontSize: 18, color: 'var(--accent)' }}>{i + 1}</td>
                    <td className="muted">{fmtTime(it.scannedAt)}</td>
                    <td className="muted small">{p ? originLabel(p) : `${it.student} · ${it.assignment}`}</td>
                    <td>{it.problem}</td>
                    <td>{it.guesses[0]?.student ? `${it.guesses[0].studentName} · ${it.guesses[0].assignment}${it.guesses[0].page ? ` · ${sideLabel(it.guesses[0].page, it.guesses[0].side)}` : ''}` : <span className="muted">Needs a look</span>}</td>
                    <td className="muted">{ago(it.waitingSince)}</td>
                  </tr>
                )
              })}
              {items.length === 0 && <tr><td colSpan={6} className="muted">Empty.</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="muted small">Filed from review this week: {data.filedThisWeek}. Pages the scanner placed on its own: {data.autoThisWeek}.</div>
      </section>
    </main>
  )
}
