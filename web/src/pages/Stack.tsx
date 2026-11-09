import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { get, post, useFetch, fmtTime, fileUrl, sideLabel, type Assignment, type Page, type ReviewItem, type Student } from '../api'

interface ReviewData { items: ReviewItem[]; pages: Record<string, Page>; assignments: Assignment[] }
interface AssignmentDetail { assignment: Assignment; expected: number; students: Array<Student & { packet: unknown | null }> }

// Pages scanned in order with no code, cut into packets: every `sizes[k]`
// pages are one student's work, in the order they came off the scanner.
function chunk<T>(pages: T[], sizes: number[], fallback: number): T[][] {
  const out: T[][] = []
  let i = 0, k = 0
  while (i < pages.length) {
    const n = Math.max(1, sizes[k] ?? fallback)
    out.push(pages.slice(i, i + n))
    i += n
    k++
  }
  return out
}

export default function Stack() {
  const nav = useNavigate()
  const { data, error } = useFetch<ReviewData>('/api/review')
  const [assignment, setAssignment] = useState('')
  const [detail, setDetail] = useState<AssignmentDetail | null>(null)
  const [excluded, setExcluded] = useState<Set<number>>(new Set())
  const [sizes, setSizes] = useState<number[]>([])
  const [picks, setPicks] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<string | null>(null)
  const [newA, setNewA] = useState<{ code: string; title: string; klass: string; grade: string; sheets: number; twoSided: boolean } | null>(null)
  const [err, setErr] = useState<string | null>(null)

  const pages = useMemo(() => (data ? data.items.filter((i) => i.kind === 'page' && i.pageId && !data.pages[i.pageId]?.decoded).map((i) => data.pages[i.pageId!]).filter(Boolean).sort((a, b) => a.seq - b.seq) : []), [data])
  const included = pages.filter((p) => !excluded.has(p.id))

  useEffect(() => {
    if (!assignment) return setDetail(null)
    get<AssignmentDetail>(`/api/assignments/${assignment}`).then((d) => { setDetail(d); setSizes([]); setPicks({}) }).catch((e) => setErr(e.message))
  }, [assignment])

  const expected = detail?.expected ?? 1
  const packets = chunk(included, sizes, expected)
  // students of the class who have not turned this in yet, in name order: the usual order of a collected pile
  const roster = useMemo(() => (detail ? detail.students.filter((s) => !s.packet).sort((a, b) => a.name.localeCompare(b.name)) : []), [detail])
  const everyone = detail?.students ?? []
  const pickFor = (k: number) => picks[k] ?? roster[k]?.code ?? ''
  const used = new Map<string, number>()
  packets.forEach((_, k) => { const c = pickFor(k); if (c) used.set(c, (used.get(c) ?? 0) + 1) })
  const dupes = [...used.entries()].filter(([, n]) => n > 1).map(([c]) => everyone.find((s) => s.code === c)?.name ?? c)
  const unnamed = packets.filter((_, k) => !pickFor(k)).length
  const ready = !!detail && packets.length > 0 && unnamed === 0 && dupes.length === 0 && !busy

  async function fileAll() {
    if (!ready || !detail) return
    setBusy(true)
    setErr(null)
    const a = detail.assignment
    const items: Array<{ pageId: number; student: string; assignment: string; page: number; side: string }> = []
    packets.forEach((pk, k) => {
      const student = pickFor(k)
      pk.forEach((pg, i) => {
        const side = a.twoSided ? { page: Math.floor(i / 2) + 1, side: i % 2 === 0 ? 'a' : 'b' } : { page: i + 1, side: 'a' }
        items.push({ pageId: pg.id, student, assignment: a.code, ...side })
      })
    })
    try {
      const r = await post<{ filed: number[]; failed: Array<{ pageId: number; error: string }> }>('/api/review/batch', { items })
      setResult(`Filed ${r.filed.length} page${r.filed.length === 1 ? '' : 's'} into ${packets.length} packet${packets.length === 1 ? '' : 's'}.${r.failed.length ? ` ${r.failed.length} could not be filed: ${r.failed.map((f) => f.error).join('; ')}` : ''}`)
      if (!r.failed.length) setTimeout(() => nav(`/assignments/${a.code}`), 1200)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  async function createAssignment() {
    if (!newA) return
    try {
      setErr(null)
      const a = await post<Assignment>('/api/assignments', { ...newA, grade: newA.grade ? Number(newA.grade) : null, assignedOn: new Date().toISOString().slice(0, 10) })
      setNewA(null)
      setAssignment(a.code)
    } catch (e) {
      setErr((e as Error).message)
    }
  }

  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>
  const classes = [...new Set(everyone.map((s) => s.klass))]

  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over"><Link to="/review">Review</Link> <span className="muted">/</span> File a stack</div>
        <h1 className="serif title">File a stack</h1>
        <p className="lede">Work scanned without codes, in the order it came off the scanner. Say which assignment it is; the stack is cut into one packet per student and each packet gets the next name on the roster. Check the names against the pages, fix any, then file them all.</p>
      </section>

      <section className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Assignment</span>
          <select value={assignment} onChange={(e) => setAssignment(e.target.value)}><option value="">Choose</option>{data.assignments.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.title} · {a.klass}{a.grade != null ? ` G${a.grade}` : ''}</option>)}</select>
        </label>
        <button className="btn" onClick={() => setNewA(newA ? null : { code: '', title: '', klass: classes[0] ?? '', grade: '', sheets: 1, twoSided: true })}>{newA ? 'Cancel' : 'New assignment'}</button>
        {detail && <span className="muted small">{expected} side{expected === 1 ? '' : 's'} per student · {detail.assignment.sheets} sheet{detail.assignment.sheets === 1 ? '' : 's'}{detail.assignment.twoSided ? ', both sides' : ''} · {roster.length} students still to turn in</span>}
        <span className="muted small" style={{ marginLeft: 'auto' }}>{included.length} of {pages.length} pages in the stack</span>
      </section>

      {newA && (
        <form className="card" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); void createAssignment() }}>
          <div className="row" style={{ gap: 12 }}>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Code</span><input type="text" required value={newA.code} onChange={(e) => setNewA({ ...newA, code: e.target.value.toUpperCase() })} placeholder="W20" style={{ width: 90 }} /></label>
            <label className="col" style={{ gap: 4, flex: 1 }}><span className="over quiet" style={{ fontSize: 10 }}>Title</span><input type="text" required value={newA.title} onChange={(e) => setNewA({ ...newA, title: e.target.value })} /></label>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Class</span><input type="text" required list="stack-classes" value={newA.klass} onChange={(e) => setNewA({ ...newA, klass: e.target.value })} style={{ width: 130 }} /><datalist id="stack-classes">{classes.map((c) => <option key={c} value={c} />)}</datalist></label>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Grade</span><input type="number" min={1} max={6} value={newA.grade} onChange={(e) => setNewA({ ...newA, grade: e.target.value })} style={{ width: 70 }} /></label>
            <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Sheets</span><input type="number" min={1} max={20} value={newA.sheets} onChange={(e) => setNewA({ ...newA, sheets: Number(e.target.value) })} style={{ width: 70 }} /></label>
            <label className="row" style={{ alignSelf: 'flex-end', paddingBottom: 8 }}><input type="checkbox" checked={newA.twoSided} onChange={(e) => setNewA({ ...newA, twoSided: e.target.checked })} /> Both sides</label>
            <button type="submit" className="btn primary" style={{ alignSelf: 'flex-end' }}>Save</button>
          </div>
        </form>
      )}
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}

      {pages.length === 0 && <div className="notice">No uncoded pages are waiting in review. Scan the pile, then come back here.</div>}

      {detail && packets.length > 0 && (
        <section className="col" style={{ gap: 14 }}>
          <div className="between">
            <div className="over">Packets, in scan order</div>
            <div className="muted small">Each row is one student. If a student has fewer or more sides than usual, change the count on their row and the rows below shift. Click a page to take it out of the stack.</div>
          </div>
          {packets.map((pk, k) => (
            <div key={pk[0].id} className="card" style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
              <div className="serif" style={{ fontSize: 22, color: 'var(--accent)', width: 32 }}>{k + 1}</div>
              <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
                {pk.map((pg, i) => {
                  const side = detail.assignment.twoSided ? sideLabel(Math.floor(i / 2) + 1, i % 2 === 0 ? 'a' : 'b') : sideLabel(i + 1, 'a')
                  return (
                    <button key={pg.id} className="thumb" title={`Scanned ${fmtTime(pg.scannedAt)} · ${pg.sourceName} · click to take out of the stack`} onClick={() => setExcluded((s) => new Set([...s, pg.id]))} style={{ width: 96, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                      <img src={fileUrl(pg.thumbPath ?? pg.filePath)} alt={side} />
                      <span>{side}</span>
                    </button>
                  )
                })}
                {pk.length < expected && <span className="muted small" style={{ alignSelf: 'center' }}>{expected - pk.length} side{expected - pk.length === 1 ? '' : 's'} short</span>}
              </div>
              <div className="col" style={{ gap: 8, marginLeft: 'auto', minWidth: 260 }}>
                <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Student</span>
                  <select value={pickFor(k)} onChange={(e) => setPicks({ ...picks, [k]: e.target.value })}>
                    <option value="">Choose</option>
                    {everyone.map((s) => <option key={s.code} value={s.code}>{s.name}{s.packet ? ' · already in' : ''}</option>)}
                  </select>
                </label>
                <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>Sides</span>
                  <input type="number" min={1} max={20} value={sizes[k] ?? expected} onChange={(e) => { const next = [...sizes]; for (let j = 0; j < k; j++) if (next[j] == null) next[j] = expected; next[k] = Number(e.target.value); setSizes(next) }} style={{ width: 64 }} />
                </label>
              </div>
            </div>
          ))}
          {excluded.size > 0 && <div className="muted small">{excluded.size} page{excluded.size === 1 ? '' : 's'} taken out of the stack; they stay in review. <button className="btn" onClick={() => setExcluded(new Set())}>Put them back</button></div>}
          {dupes.length > 0 && <p className="err" style={{ margin: 0 }}>{dupes.join(', ')} chosen more than once.</p>}
          {unnamed > 0 && <p className="muted small" style={{ margin: 0 }}>{unnamed} packet{unnamed === 1 ? '' : 's'} still without a student.</p>}
          <div className="row" style={{ gap: 12 }}>
            <button className="btn primary" disabled={!ready} onClick={() => void fileAll()}>{busy ? 'Filing' : `File ${packets.length} packet${packets.length === 1 ? '' : 's'}, ${included.length} pages`}</button>
            {result && <span className="small">{result}</span>}
          </div>
        </section>
      )}
    </main>
  )
}
