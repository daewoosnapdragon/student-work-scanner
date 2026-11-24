import { useEffect, useMemo, useRef, useState, type DragEvent } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { get, post, useFetch, fileUrl, fmtTime, sideLabel, type Assignment, type Page, type ReviewItem, type Student } from '../api'
import { useViewer } from '../components/Viewer'
import { sidesOf } from '../../../shared/codeInput'
import { applyTyped, batchItems, clashes, cycleSide, place, unplace, type Placements } from './sortLogic'
import { readTyped, type Typed } from './typed'

interface ReviewData { items: ReviewItem[]; pages: Record<string, Page>; assignments: Assignment[] }
interface AssignmentDetail { assignment: Assignment; expected: number; students: Array<Student & { packet: unknown | null; pages: Page[] }> }

// Pages that are not part of any pile, sorted by hand: drag a page (or every
// selected page) onto a student, and it takes the next open side. Or type what
// the label says and apply it to the selected pages.
export default function Loose() {
  const nav = useNavigate()
  const { data, error } = useFetch<ReviewData>('/api/review')
  const [assignment, setAssignment] = useState('')
  const [detail, setDetail] = useState<AssignmentDetail | null>(null)
  const [placements, setPlacements] = useState<Placements>(new Map())
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [over, setOver] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const { open: openViewer } = useViewer()
  const [typed, setTyped] = useState('')
  const [matches, setMatches] = useState<Student[]>([])
  const [note, setNote] = useState<string | null>(null)
  const [pending, setPending] = useState<{ ids: number[]; to: Typed } | null>(null)
  const typedRef = useRef<HTMLInputElement>(null)

  const pages = useMemo(() => (data ? data.items.filter((i) => i.kind === 'page' && i.pageId).map((i) => data.pages[i.pageId!]).filter(Boolean).sort((a, b) => a.seq - b.seq) : []), [data])
  const byId = useMemo(() => new Map(pages.map((p) => [p.id, p])), [pages])
  const tray = pages.filter((p) => !placements.has(p.id))

  useEffect(() => {
    if (!assignment) return setDetail(null)
    get<AssignmentDetail>(`/api/assignments/${assignment}`).then((d) => { setDetail(d); setPlacements(new Map()); setErr(null) }).catch((e) => setErr(e.message))
  }, [assignment])
  // Pages filed meanwhile (by the scanner, or in another tab) leave the sort.
  useEffect(() => { setPlacements((pl) => new Map([...pl].filter(([id]) => byId.has(id)))); setSelected((s) => new Set([...s].filter((id) => byId.has(id)))) }, [byId])

  // A name at the front of what was typed is looked up on the roster.
  const typedName = useMemo(() => readTyped(typed, []).name ?? '', [typed])
  useEffect(() => {
    if (!typedName) return setMatches([])
    const t = setTimeout(() => get<Student[]>(`/api/students/search?q=${encodeURIComponent(typedName)}`).then(setMatches).catch(() => setMatches([])), 150)
    return () => clearTimeout(t)
  }, [typedName])
  const read = useMemo(() => readTyped(typed, matches), [typed, matches])

  const sides = detail ? sidesOf(detail.assignment) : []
  const filedBy = useMemo(() => new Map((detail?.students ?? []).map((s) => [s.code, new Set(s.pages.map((p) => `${p.page}${p.side}`))])), [detail])
  const students = useMemo(() => (detail?.students ?? []).slice().sort((a, b) => a.name.localeCompare(b.name)), [detail])
  const shown = filter.trim() ? students.filter((s) => `${s.name} ${s.nameKo ?? ''} ${s.code}`.toLowerCase().includes(filter.trim().toLowerCase())) : students
  const placedBy = (code: string) => [...placements.entries()].filter(([, p]) => p.student === code).map(([id, p]) => ({ pg: byId.get(id)!, ...p })).filter((x) => x.pg).sort((a, b) => a.pg.seq - b.pg.seq)
  const problems = clashes(placements)
  const touched = new Set([...placements.values()].map((p) => p.student)).size

  function applyRead(ids: number[], to: Typed) {
    if (!to.student) return
    if (!students.some((s) => s.code === to.student)) return setNote(`${to.student} is not in ${detail?.assignment.klass ?? 'this class'}.`)
    setPlacements((pl) => applyTyped(pl, ids, { student: to.student!, page: to.page, side: to.side }, sides, filedBy.get(to.student!) ?? new Set()))
    setSelected(new Set())
    setTyped('')
    setNote(null)
  }
  function applyTypedLabel() {
    if (!read.student) return setNote(typedName && matches.length === 0 ? `No student called ${typedName}.` : matches.length > 1 ? 'Which one? Choose a student below.' : 'Student code, then the side: S07 W23 2 back.')
    const ids = [...selected].filter((id) => !placements.has(id))
    if (!ids.length) return setNote('Select pages in the tray first, then type their label.')
    if (read.assignment && read.assignment !== assignment) {
      if (!data?.assignments.some((a) => a.code === read.assignment)) return setNote(`${read.assignment} is not an assignment yet.`)
      setPending({ ids, to: read })
      setAssignment(read.assignment)
      return
    }
    if (!detail) return setNote('Choose the assignment first, or type it: S07 W23 2 back.')
    applyRead(ids, read)
  }
  // The typed label named another assignment: apply once its students have loaded.
  useEffect(() => {
    if (pending && detail && detail.assignment.code === pending.to.assignment) { applyRead(pending.ids, pending.to); setPending(null) }
  })

  // Dragging a selected page carries every selected page; an unselected one goes alone.
  function dragIds(id: number) { return selected.has(id) ? [...selected] : [id] }
  function onDragStart(e: DragEvent, id: number) {
    e.dataTransfer.setData('text/plain', dragIds(id).join(','))
    e.dataTransfer.effectAllowed = 'move'
  }
  function dropped(e: DragEvent): number[] {
    e.preventDefault()
    return e.dataTransfer.getData('text/plain').split(',').map(Number).filter((n) => Number.isFinite(n) && byId.has(n))
  }
  function putOn(code: string, ids: number[]) {
    if (!ids.length) return
    setPlacements((pl) => place(pl, ids, code, sides, filedBy.get(code) ?? new Set()))
    setSelected(new Set())
  }
  function toggle(id: number, range: boolean) {
    setSelected((s) => {
      const n = new Set(s)
      if (range && s.size) {
        // shift-click: everything in the tray between the last selected page and this one
        const order = tray.map((p) => p.id)
        const last = [...s].map((x) => order.indexOf(x)).filter((i) => i >= 0).pop() ?? order.indexOf(id)
        const here = order.indexOf(id)
        for (let i = Math.min(last, here); i <= Math.max(last, here); i++) n.add(order[i])
        return n
      }
      if (n.has(id)) n.delete(id); else n.add(id)
      return n
    })
  }

  async function fileAll() {
    if (!detail || !placements.size || busy) return
    setBusy(true)
    setErr(null)
    try {
      const r = await post<{ filed: number[]; failed: Array<{ pageId: number; error: string }> }>('/api/review/batch', { items: batchItems(placements, detail.assignment.code, filedBy) })
      if (r.failed.length) {
        setErr(`${r.filed.length} filed; ${r.failed.length} could not be: ${r.failed.map((f) => f.error).join('; ')}`)
        setPlacements((pl) => new Map([...pl].filter(([id]) => r.failed.some((f) => f.pageId === id))))
      } else nav(`/assignments/${detail.assignment.code}`)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return
      if (e.key === 'Escape') setSelected(new Set())
      else if (e.key === '/') { e.preventDefault(); typedRef.current?.focus() }
      else if ((e.key === 'a' || e.key === 'A') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); setSelected(new Set(tray.map((p) => p.id))) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>

  const thumb = (pg: Page, extra?: { label?: string; onLabel?: () => void; replaces?: boolean }) => (
    <div key={pg.id} draggable onDragStart={(e) => onDragStart(e, pg.id)} onClick={(e) => { if (!extra) toggle(pg.id, e.shiftKey) }} onDoubleClick={() => openViewer([{ src: fileUrl(pg.filePath), label: pg.sourceName, pageId: pg.id }])}
      title={`Scanned ${fmtTime(pg.scannedAt)} · ${pg.sourceName}${extra ? ' · drag back to the tray or onto another student' : ' · click to select, shift-click for a run, drag onto a student'} · double-click to see large`}
      className="thumb" style={{ width: 84, cursor: 'grab', outline: selected.has(pg.id) ? '3px solid var(--accent)' : undefined, outlineOffset: 2, userSelect: 'none' }}>
      <img src={fileUrl(pg.thumbPath ?? pg.filePath)} alt="" draggable={false} style={{ pointerEvents: 'none' }} />
      {extra ? (
        <button type="button" className={`chip ${extra.replaces ? 'on' : ''}`} onClick={(e) => { e.stopPropagation(); extra.onLabel?.() }} title={`${extra.replaces ? 'This side is filed already; filing replaces it. ' : ''}Click to move to the next side`} style={{ cursor: 'pointer', fontFamily: 'inherit', padding: '1px 6px' }}>{extra.label}</button>
      ) : <span>{fmtTime(pg.scannedAt).slice(0, 5)}</span>}
    </div>
  )

  return (
    <main style={{ gap: 24 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over"><Link to="/scan">Scan</Link> <span className="muted">/</span> Loose pages</div>
        <h1 className="serif title">Loose pages</h1>
        <p className="lede">Pages that are not part of any pile: single scans, pages a jumbled pile could not settle, and sheets you left loose. Drag each onto its student.</p>
      </section>

      <section className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Assignment</span>
          <select value={assignment} onChange={(e) => setAssignment(e.target.value)}><option value="">Choose</option>{data.assignments.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.title} · {a.klass}{a.grade != null ? ` G${a.grade}` : ''}</option>)}</select>
        </label>
        {detail && <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Find a student</span><input type="text" value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="name or code" style={{ width: 160 }} /></label>}
        {detail && <span className="muted small">{sides.length} side{sides.length === 1 ? '' : 's'} per student · {students.length} students</span>}
        <span className="muted small" style={{ marginLeft: 'auto' }}>{tray.length} of {pages.length} pages still in the tray{selected.size ? ` · ${selected.size} selected` : ''}</span>
      </section>

      {pages.length === 0 && <div className="notice">No loose pages. Everything the scanner saw is in a pile or filed. <Link to="/scan">Back to Scan</Link></div>}

      {pages.length > 0 && (
        <section className="col" style={{ gap: 4 }}>
          <label className="col" style={{ gap: 4 }}>
            <span className="over">Type what the label says</span>
            <input ref={typedRef} type="text" value={typed} onChange={(e) => { setTyped(e.target.value); setNote(null) }} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applyTypedLabel() } }} placeholder="S07 W23 2 back · or a name: Minji W23 2 back" autoComplete="off" style={{ fontSize: 15, maxWidth: 420 }} />
          </label>
          <span className="muted small">
            {note ? <span className="err">{note}</span>
              : typed.trim() && read.student ? <>Read as <b>{students.find((s) => s.code === read.student)?.name ?? matches[0]?.name ?? read.student}</b>{read.page && read.side ? `, ${sideLabel(read.page, read.side)}` : ''}. Enter puts the {selected.size || 'selected'} page{selected.size === 1 ? '' : 's'} there.</>
              : typed.trim() && matches.length > 1 ? 'Which one?'
              : <>Select pages in the tray, type the label, press Enter. <kbd className="key">/</kbd> jumps here.</>}
          </span>
          {typed.trim() && matches.length > 1 && (
            <div className="card" style={{ padding: 6, gap: 2, maxWidth: 420 }}>
              {matches.map((m) => <button key={m.code} type="button" className="tab" style={{ textAlign: 'left', padding: '4px 6px' }} onClick={() => { const rest = typed.trim().split(/[\s:|·,/]+/).filter((t) => /\d/.test(t)); setTyped([m.code, ...rest].join(' ')); setMatches([m]) }}>{m.name} · {m.code} · {m.klass}</button>)}
            </div>
          )}
        </section>
      )}

      {pages.length > 0 && (
        <section className="card" onDragOver={(e) => { e.preventDefault(); setOver('tray') }} onDragLeave={() => setOver(null)} onDrop={(e) => { setOver(null); setPlacements((pl) => unplace(pl, dropped(e))) }} style={{ borderColor: over === 'tray' ? 'var(--accent)' : undefined, borderStyle: over === 'tray' ? 'dashed' : undefined }}>
          <div className="between">
            <div className="over">The tray, in scan order <span className="muted small" style={{ textTransform: 'none', letterSpacing: 0, marginLeft: 8 }}><kbd className="key">Esc</kbd> clear selection · <kbd className="key">{/Mac/.test(navigator.platform) ? '⌘' : 'Ctrl'}</kbd><kbd className="key">A</kbd> select all</span></div>
            <div className="row" style={{ gap: 8 }}>
              {tray.length > 0 && <button className="btn" onClick={() => setSelected(new Set(tray.map((p) => p.id)))}>Select all</button>}
              {selected.size > 0 && <button className="btn" onClick={() => setSelected(new Set())}>Clear selection</button>}
            </div>
          </div>
          <div className="row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'flex-start', minHeight: 60 }}>
            {tray.map((pg) => thumb(pg))}
            {tray.length === 0 && <span className="muted small">Every page is on a student. Drop one here to take it back, or file them below.</span>}
          </div>
        </section>
      )}

      {detail && pages.length > 0 && (
        <section className="col" style={{ gap: 12 }}>
          <div className="over">Students in {detail.assignment.klass}, drop pages here</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 12 }}>
            {shown.map((s) => {
              const filed = filedBy.get(s.code) ?? new Set<string>()
              const placed = placedBy(s.code)
              const missing = sides.filter((x) => !filed.has(`${x.page}${x.side}`) && !placed.some((p) => p.page === x.page && p.side === x.side))
              const isOver = over === s.code
              return (
                <div key={s.code} className="card" onDragOver={(e) => { e.preventDefault(); setOver(s.code) }} onDragLeave={() => setOver(null)} onDrop={(e) => { setOver(null); putOn(s.code, dropped(e)) }}
                  style={{ borderColor: isOver ? 'var(--accent)' : placed.length ? 'var(--ink2)' : undefined, borderStyle: isOver ? 'dashed' : undefined, background: isOver ? 'var(--paper)' : undefined, minHeight: 120 }}>
                  <div className="between" style={{ alignItems: 'baseline' }}>
                    <span style={{ fontWeight: 600 }}>{s.name}{s.nameKo ? <span className="muted"> {s.nameKo}</span> : null} <span className="muted small">{s.code}</span></span>
                    {selected.size > 0 && <button className="btn" style={{ padding: '1px 8px' }} onClick={() => putOn(s.code, [...selected])}>Put {selected.size} here</button>}
                  </div>
                  <div className="muted small">
                    {filed.size ? `filed: ${[...filed].map((k) => sideLabel(Number(k.slice(0, -1)), k.slice(-1))).join(', ')}` : 'nothing filed yet'}
                    {missing.length ? ` · still needs ${missing.map((m) => sideLabel(m.page, m.side)).join(', ')}` : filed.size || placed.length ? ' · complete' : ''}
                  </div>
                  <div className="row" style={{ gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                    {placed.map(({ pg, page, side }) => thumb(pg, { label: sideLabel(page, side), replaces: filed.has(`${page}${side}`), onLabel: () => setPlacements((pl) => cycleSide(pl, pg.id, sides)) }))}
                  </div>
                </div>
              )
            })}
          </div>
          <div className="row" style={{ gap: 12, flexWrap: 'wrap', position: 'sticky', bottom: 0, background: 'var(--bg)', borderTop: '1px solid var(--line)', padding: '12px 0', zIndex: 2 }}>
            <button className="btn primary" disabled={!placements.size || problems.length > 0 || busy} onClick={() => void fileAll()}>{busy ? 'Filing' : `File ${placements.size} page${placements.size === 1 ? '' : 's'} onto ${touched} student${touched === 1 ? '' : 's'}`}</button>
            {problems.length > 0 ? <span className="err">Two pages on the same side: {problems.map((c) => `${students.find((s) => s.code === c.student)?.name ?? c.student} ${sideLabel(Number(c.side.slice(0, -1)), c.side.slice(-1))}`).join(', ')}. Click a side label to change it.</span>
              : err ? <span className="err">{err}</span>
              : [...placements.values()].some((p) => filedBy.get(p.student)?.has(`${p.page}${p.side}`)) ? <span className="muted small">Sides marked in red are filed already and will be replaced.</span>
              : placements.size === 0 ? <span className="muted small">Drag pages onto students, then file them all at once.</span> : null}
          </div>
        </section>
      )}
      {!detail && pages.length > 0 && <div className="notice">Choose the assignment to see its students.</div>}
    </main>
  )
}
