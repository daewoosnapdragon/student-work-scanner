import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { get, post, useFetch, fileUrl, type Assignment, type Page, type Student } from '../api'
import type { PileData } from '../../../shared/types'
import { useViewer, type ViewerPage } from '../components/Viewer'
import { cutPackets, nextSheetNumber, packetSize, resolveTyped, typedQuery, type Search } from './pileCheckLogic'

interface Checked { sheet: number; to: string }

export default function PileCheck() {
  const { id } = useParams()
  const [bump, setBump] = useState(0)
  const { data, error } = useFetch<PileData>(`/api/piles/${id}`, bump)
  // what was filed or left loose on this visit, newest last
  const [checked, setChecked] = useState<Checked[]>([])
  // what went wrong with the last filing, kept here so it outlives the part of the screen that filed
  const [note, setNote] = useState<string | null>(null)
  const done = (c: Checked[], problem: string | null = null) => { setChecked((was) => [...was, ...c]); setNote(problem); setBump((b) => b + 1) }

  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>

  const { pile, assignment: a, sheets, held } = data
  const total = pile.sheets ?? sheets.length
  const filed = sheets.filter((s) => s.status === 'filed').length
  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over"><Link to="/scan">Scan</Link> <span className="muted">/</span> {pile.name}</div>
        <h1 className="serif title" style={{ fontSize: 30 }}>
          {a ? `${a.title} · ${a.code} · ` : ''}{total} sheet{total === 1 ? '' : 's'}, {filed} filed, {held.length} to check
        </h1>
      </section>

      {!a ? (
        <section className="col" style={{ gap: 12 }}>
          <p className="lede">This pile has no assignment yet. Name it on the Scan screen and its sheets file themselves.</p>
          <div className="row"><Link to="/scan" className="btn primary">Back to Scan</Link></div>
        </section>
      ) : held.length === 0 ? (
        <section className="col" style={{ gap: 12 }}>
          <p className="lede">Nothing left to check.</p>
          <div className="row" style={{ gap: 10 }}>
            <Link to={`/assignments/${a.code}`} className="btn primary">Open {a.code}</Link>
            <Link to="/scan" className="btn">Back to Scan</Link>
          </div>
        </section>
      ) : data.packets ? (
        <Packets data={data} assignment={a} onFiled={done} />
      ) : (
        <HeldOne data={data} assignment={a} onDone={done} />
      )}

      {(checked.length > 0 || note) && (
        <section className="col sep" style={{ gap: 8 }}>
          {checked.length > 0 && (
            <div className="row" style={{ gap: 18 }}>
              <span className="over quiet">Checked so far</span>
              {checked.map((c, i) => <span key={i} className="small">✓ sheet {c.sheet} → {c.to}</span>)}
            </div>
          )}
          {note && <p className="err" style={{ margin: 0 }}>{note}</p>}
        </section>
      )}
    </main>
  )
}

// After a mouse click a button lets go of focus, so Enter goes back to filing; a keyboard press keeps its place.
const blurIfMouse = (e: MouseEvent<HTMLElement>) => { if (e.detail > 0) e.currentTarget.blur() }

// ---------- held sheets, one at a time ----------

function HeldOne({ data, assignment: a, onDone }: { data: PileData; assignment: Assignment; onDone: (c: Checked[], problem?: string | null) => void }) {
  const { pile, sheets } = data
  const held = useMemo(() => [...data.held].sort((x, y) => x.sheet - y.sheet), [data.held])
  // The sheet under the cursor, by number, so a refetch that adds or drops held sheets does not swap it.
  // When it is filed and leaves the list, the cursor moves on to the next held sheet after it (or the last one).
  const [cur, setCur] = useState<number | null>(null)
  const at = cur == null ? 0 : (() => { const i = held.findIndex((x) => x.sheet >= cur); return i === -1 ? held.length - 1 : i })()
  const h = held[at]
  const moveTo = (i: number) => setCur(held[Math.max(0, Math.min(i, held.length - 1))].sheet)
  const row = sheets[h.sheet - 1]
  const front = row?.front ?? null
  const back = row?.back ?? null
  // at most two guesses, so Someone else is always within 1-3
  const guesses = h.guesses.slice(0, 2)
  const otherN = guesses.length + 1
  const [pick, setPick] = useState(1)
  const [typed, setTyped] = useState('')
  const [search, setSearch] = useState<Search | null>(null)
  // the sheets a student still lacks and the sheet number chosen, each tied to the student they are for
  const [lackingFor, setLackingFor] = useState<{ student: string; lacking: number[] } | null>(null)
  const [sheetPick, setSheetPick] = useState<{ student: string; n: number } | null>(null)
  const [rotate, setRotate] = useState(0)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const typedRef = useRef<HTMLInputElement>(null)
  const { open: openViewer } = useViewer()

  useEffect(() => {
    setPick(1); setTyped(''); setSearch(null); setLackingFor(null); setSheetPick(null); setRotate(0); setErr(null)
  }, [h.sheet])

  // A name, or a bare student code, is looked up on the roster; the answer carries the text it was for.
  const query = useMemo(() => typedQuery(typed), [typed])
  useEffect(() => {
    if (!query) return
    let alive = true
    const t = setTimeout(() => get<Student[]>(`/api/students/search?q=${encodeURIComponent(query)}`)
      .then((list) => alive && setSearch({ q: query, list }))
      .catch(() => alive && setSearch({ q: query, list: [] })), 150)
    return () => { alive = false; clearTimeout(t) }
  }, [query])
  // the search stays: it is keyed by its query, and resolveTyped ignores it once the query changes
  const onType = (text: string) => { setTyped(text); setPick(otherN); setErr(null) }

  const resolved = resolveTyped(typed, search, a.code, data.roster)
  const typedAs = resolved.kind === 'one' ? resolved : null

  // The sheets the typed student still lacks, for the sheet number on offer.
  useEffect(() => {
    if (!typedAs) return
    let alive = true
    const student = typedAs.student
    get<Page[]>(`/api/packets/${a.code}/${student}/pages`)
      .then((ps) => {
        if (!alive) return
        const have = new Set(ps.map((p) => p.page))
        setLackingFor({ student, lacking: Array.from({ length: a.sheets }, (_, i) => i + 1).filter((n) => !have.has(n)) })
      })
      .catch(() => alive && setLackingFor({ student, lacking: Array.from({ length: a.sheets }, (_, i) => i + 1) }))
    return () => { alive = false }
  }, [typedAs?.student, a.code, a.sheets])
  const lacking = typedAs && lackingFor?.student === typedAs.student ? lackingFor.lacking : null

  const guess = pick <= guesses.length ? guesses[pick - 1] : null
  const otherSheet = typedAs && sheetPick?.student === typedAs.student ? sheetPick.n : nextSheetNumber(lacking ?? [], typedAs?.page ?? null)
  // Someone else files only once the name has resolved and that student's sheets are known
  const target = guess
    ? { student: guess.student, name: guess.studentName, page: guess.page }
    : typedAs && lacking ? { student: typedAs.student, name: typedAs.name, page: otherSheet } : null
  const waitingWhy = guess ? null
    : resolved.kind === 'empty' ? 'Type a name or a student code for someone else, or pick a guess.'
    : resolved.kind === 'searching' || (typedAs && !lacking) ? 'Still looking that name up.'
    : resolved.kind === 'several' ? 'Several students match; choose one.'
    : resolved.kind === 'none' ? `No student called ${resolved.query}.`
    : null

  async function fileIt() {
    if (busy) return
    if (!target) return setErr(waitingWhy ?? 'Pick a guess first.')
    setBusy(true); setErr(null)
    try {
      await post(`/api/piles/${pile.id}/sheets/${h.sheet}/file`, { student: target.student, page: target.page })
      onDone([{ sheet: h.sheet, to: `${target.name}, sheet ${target.page}` }])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  async function leaveLoose() {
    if (busy) return
    setBusy(true); setErr(null)
    try {
      await post(`/api/piles/${pile.id}/sheets/${h.sheet}/loose`, {})
      onDone([{ sheet: h.sheet, to: 'loose pages' }])
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.metaKey || e.ctrlKey || e.altKey || location.hash === '#view') return
      const t = e.target as HTMLElement
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) {
        if (e.key === 'Enter' && (t.tagName === 'INPUT' || t.tagName === 'SELECT')) { e.preventDefault(); void fileIt() }
        if (e.key === 'Escape') t.blur()
        return
      }
      // Enter on a focused button or link does what that button or link does (the File button files); anywhere else it files
      if (e.key === 'Enter' && t && (t.tagName === 'BUTTON' || t.tagName === 'A')) return
      if (e.key === 'j' || e.key === 'J') moveTo(at + 1)
      else if (e.key === 'k' || e.key === 'K') moveTo(at - 1)
      else if (/^[1-3]$/.test(e.key) && Number(e.key) <= otherN) {
        setPick(Number(e.key))
        if (Number(e.key) === otherN) { e.preventDefault(); typedRef.current?.focus() }
      }
      else if (e.key === 'Enter') { e.preventDefault(); void fileIt() }
      else if (e.key === 'x' || e.key === 'X') void leaveLoose()
      else if (e.key === 'r' || e.key === 'R') setRotate((r) => (r + 90) % 360)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const views: ViewerPage[] = [front, back].filter((p): p is Page => !!p).map((p) => ({ src: fileUrl(p.filePath), label: `Sheet ${h.sheet}, ${p === front ? 'front' : 'back'}`, sub: h.why, pageId: p.id }))
  const side = (p: Page | null, label: string, at: number) => (
    <div className="col" style={{ gap: 4 }}>
      <span className="over quiet" style={{ fontSize: 10 }}>{label}</span>
      {p ? (
        <button type="button" className="scanlink" onClick={(e) => { blurIfMouse(e); openViewer(views, at) }} title="Open large. Wheel to zoom, drag to move, Esc to close.">
          <img className="scan" src={fileUrl(p.filePath)} alt={`Sheet ${h.sheet}, ${label}`} style={{ transform: `rotate(${rotate}deg)` }} />
        </button>
      ) : <div className="notice">No page here.</div>}
    </div>
  )

  return (
    <>
      <div className="muted small row" style={{ gap: 16 }}>
        <span><kbd className="key">J</kbd><kbd className="key">K</kbd> next, previous</span>
        {otherN > 1
          ? <span><kbd className="key">1</kbd> to <kbd className="key">{otherN}</kbd> pick</span>
          : <span><kbd className="key">1</kbd> picks Someone else</span>}
        <span><kbd className="key">Enter</kbd> file both sides</span>
        <span><kbd className="key">X</kbd> leave it loose</span>
        <span><kbd className="key">R</kbd> rotate</span>
      </div>

      <section className="col" style={{ gap: 14 }}>
        <div className="between" style={{ borderBottom: '1px solid var(--line)', paddingBottom: 6 }}>
          <div className="over">Sheet {h.sheet} of {pile.sheets ?? sheets.length}</div>
          <div className="muted small">{held.length > 1 ? `${at + 1} of ${held.length} to check` : 'the last one to check'}</div>
        </div>
        <div className="grid2" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(0, 2fr)', gap: 32 }}>
          <div className="grid2" style={{ gap: 12, alignItems: 'start', gridTemplateColumns: back || pile.twoSided ? 'repeat(2, minmax(0, 1fr))' : 'minmax(0, 1fr)' }}>
            {side(front, 'front', 0)}
            {(back || !!pile.twoSided) && side(back, 'back', front ? 1 : 0)}
          </div>

          <div className="col" style={{ gap: 14 }}>
            <p style={{ margin: 0 }}><b>Why:</b> {h.why}</p>
            <div className="col" style={{ gap: 8 }}>
              {guesses.map((g, i) => (
                <button key={`${g.student}-${g.page}`} type="button" className={`guess ${pick === i + 1 ? 'on' : ''}`} onClick={(e) => { blurIfMouse(e); setPick(i + 1) }}>
                  <span className="n">{i + 1}</span>
                  <span className="col" style={{ gap: 2 }}>
                    <span style={{ fontWeight: 600 }}>{g.studentName} · sheet {g.page}</span>
                    <span className="muted small">{g.why}</span>
                  </span>
                </button>
              ))}
              <div className={`guess ${pick === otherN ? 'on' : ''}`} onClick={() => setPick(otherN)}>
                <span className="n">{otherN}</span>
                <span className="col" style={{ gap: 6, flex: 1 }}>
                  <span style={{ fontWeight: 600 }}>{typedAs ? typedAs.name : 'Someone else'}</span>
                  <span className="row" style={{ gap: 8 }}>
                    <label className="vh" htmlFor="pc-typed">Name or student code</label>
                    <input id="pc-typed" ref={typedRef} type="text" value={typed} onChange={(e) => onType(e.target.value)} placeholder="Name or code" autoComplete="off" style={{ flex: 1, minWidth: 120 }} />
                    <label className="row" style={{ gap: 4 }}>
                      <span className="muted small">sheet</span>
                      <select value={otherSheet} disabled={!lacking} onChange={(e) => { if (typedAs) setSheetPick({ student: typedAs.student, n: Number(e.target.value) }); setPick(otherN) }}>
                        {Array.from({ length: Math.max(1, a.sheets) }, (_, i) => i + 1).map((n) => (
                          <option key={n} value={n}>{n}{lacking && !lacking.includes(n) ? ' · already in' : ''}</option>
                        ))}
                      </select>
                    </label>
                  </span>
                  {resolved.kind === 'searching' && <span className="muted small">Looking up {query || 'that name'}.</span>}
                  {resolved.kind === 'none' && <span className="muted small">{query ? `No student called ${query}.` : 'A name or a student code, like S07.'}</span>}
                  {resolved.kind === 'several' && (
                    <span className="col" style={{ gap: 2 }}>
                      <span className="muted small">Which one?</span>
                      {resolved.list.map((m) => <button key={m.code} type="button" className="tab" style={{ textAlign: 'left', padding: '4px 6px' }} onClick={() => { setTyped(m.code); setSearch({ q: m.code, list: [m] }); typedRef.current?.focus() }}>{m.name} · {m.code} · {m.klass}</button>)}
                    </span>
                  )}
                </span>
              </div>
            </div>
            {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
            <div className="row" style={{ gap: 10 }}>
              <button type="button" className="btn primary" disabled={busy || !target} title={target ? undefined : (waitingWhy ?? undefined)} onClick={(e) => { blurIfMouse(e); void fileIt() }}>
                {target ? `File as ${target.name} · sheet ${target.page}` : 'File'} <span style={{ opacity: 0.7, marginLeft: 6 }}>Enter</span>
              </button>
              <button type="button" className="btn" disabled={busy} onClick={(e) => { blurIfMouse(e); void leaveLoose() }}>
                Leave it loose <span style={{ opacity: 0.7, marginLeft: 6 }}>X</span>
              </button>
            </div>
          </div>
        </div>
      </section>
    </>
  )
}

// ---------- a pile with no codes: packets, filed all at once ----------

function Packets({ data, assignment: a, onFiled }: { data: PileData; assignment: Assignment; onFiled: (c: Checked[], problem?: string | null) => void }) {
  const { pile, sheets, roster } = data
  const given = data.packets ?? []
  // the held sheets in pile order; packets are cut over their positions
  const order = useMemo(() => [...data.held].map((h) => h.sheet).sort((x, y) => x - y), [data.held])
  const perStudent = Math.max(1, a.sheets)
  // null: the packets as the server cut them
  const [edited, setSizes] = useState<number[] | null>(null)
  const sizes = edited ?? given.map((p) => p.sheets.length)
  const [picks, setPicks] = useState<Record<number, string>>({})
  // what is being typed in a packet's sheet count, kept until Enter or leaving the box
  const [drafts, setDrafts] = useState<Record<number, string>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const { open: openViewer } = useViewer()
  // who has a packet already, from the assignment's page, so the picker can say so
  const { data: detail } = useFetch<{ students: Array<{ code: string; packet: unknown }> }>(`/api/assignments/${a.code}`)
  const alreadyIn = new Set((detail?.students ?? []).filter((s) => s.packet).map((s) => s.code))

  const packets = cutPackets(order.length, perStudent, sizes).map((pk) => pk.map((i) => order[i - 1]))
  const pickFor = (k: number) => picks[k] ?? given[k]?.student ?? ''
  const nameOf = (code: string) => roster.find((s) => s.code === code)?.name ?? code
  const used = new Map<string, number>()
  packets.forEach((_, k) => { const c = pickFor(k); if (c) used.set(c, (used.get(c) ?? 0) + 1) })
  const dupes = [...used.entries()].filter(([, n]) => n > 1).map(([c]) => nameOf(c))
  const unnamed = packets.filter((_, k) => !pickFor(k)).length
  const oversized = packets.map((pk, k) => (pk.length > perStudent ? k + 1 : 0)).filter(Boolean)
  const ready = packets.length > 0 && unnamed === 0 && dupes.length === 0 && oversized.length === 0 && !busy

  function commitSize(k: number) {
    const text = drafts[k]
    if (text == null) return
    const n = packetSize(text, perStudent)
    setDrafts({})
    if (n == null) return
    const next = [...sizes]
    for (let j = 0; j < k; j++) if (next[j] == null) next[j] = perStudent
    next[k] = n
    setSizes(next)
  }
  async function fileAll() {
    if (!ready) return
    setBusy(true); setErr(null)
    try {
      const body = packets.map((pk, k) => ({ sheets: pk, student: pickFor(k) }))
      const r = await post<{ filed: number; failed: Array<{ sheet: number; error: string }> }>(`/api/piles/${pile.id}/file-all`, { packets: body })
      const failed = new Set(r.failed.map((f) => f.sheet))
      const problem = r.failed.length ? `${r.failed.length} sheet${r.failed.length === 1 ? '' : 's'} could not be filed: ${r.failed[0].error}` : null
      // the note lives on the page, since this list goes once sheets have filed
      onFiled(body.flatMap((p) => p.sheets.map((s, i) => ({ sheet: s, to: `${nameOf(p.student)}, sheet ${i + 1}` })).filter((c) => !failed.has(c.sheet))), problem)
      setSizes(null); setPicks({}); setDrafts({})
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="col" style={{ gap: 14 }}>
      <div className="between">
        <div className="over">Packets, in scan order</div>
        <div className="muted small">No codes were read, so each packet got the next student who has not turned this in. Check the names against the pages; if a student has more or fewer sheets, change the count and the packets below shift.</div>
      </div>
      {packets.map((pk, k) => {
        const views: ViewerPage[] = pk.flatMap((n) => {
          const r = sheets[n - 1]
          return [r?.front, r?.back].filter((p): p is Page => !!p).map((p) => ({ src: fileUrl(p.filePath), label: `Sheet ${n}, ${p === r?.front ? 'front' : 'back'}`, pageId: p.id }))
        })
        return (
          <div key={`${k}-${pk[0]}`} className="card" style={{ flexDirection: 'row', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
            <div className="serif" style={{ fontSize: 22, color: 'var(--accent)', width: 32 }}>{k + 1}</div>
            <div className="row" style={{ gap: 8, alignItems: 'flex-start' }}>
              {pk.map((n) => {
                const f = sheets[n - 1]?.front
                const at = views.findIndex((v) => v.pageId === f?.id)
                return (
                  <button key={n} type="button" className="thumb" title="Open large, front and back" onClick={(e) => { blurIfMouse(e); openViewer(views, Math.max(0, at)) }} style={{ width: 96, background: 'none', border: 0, padding: 0, cursor: 'pointer', font: 'inherit' }}>
                    {f ? <img src={fileUrl(f.thumbPath ?? f.filePath)} alt={`Sheet ${n}, front`} /> : <span className="notice">No page</span>}
                    <span>sheet {n}</span>
                  </button>
                )
              })}
            </div>
            <div className="col" style={{ gap: 8, marginLeft: 'auto', minWidth: 240 }}>
              <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Student</span>
                <select value={pickFor(k)} onChange={(e) => setPicks({ ...picks, [k]: e.target.value })}>
                  <option value="">Choose</option>
                  {roster.map((s) => <option key={s.code} value={s.code}>{s.name}{alreadyIn.has(s.code) ? ' · already in' : ''}</option>)}
                </select>
              </label>
              <label className="row"><span className="over quiet" style={{ fontSize: 10 }}>Sheets</span>
                <input type="number" min={1} max={perStudent} value={drafts[k] ?? String(sizes[k] ?? perStudent)} onChange={(e) => setDrafts({ [k]: e.target.value })} onBlur={() => commitSize(k)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); commitSize(k) } }} style={{ width: 64 }} />
              </label>
            </div>
          </div>
        )
      })}
      {oversized.length > 0 && <p className="err" style={{ margin: 0 }}>Packet{oversized.length === 1 ? '' : 's'} {oversized.join(', ')} {oversized.length === 1 ? 'has' : 'have'} more sheets than {a.code} has ({perStudent}); make {oversized.length === 1 ? 'it' : 'them'} smaller.</p>}
      {dupes.length > 0 && <p className="err" style={{ margin: 0 }}>{dupes.join(', ')} chosen more than once.</p>}
      {unnamed > 0 && <p className="muted small" style={{ margin: 0 }}>{unnamed} packet{unnamed === 1 ? '' : 's'} still without a student.</p>}
      {err && <p className="err" style={{ margin: 0 }}>{err}</p>}
      <div className="row">
        <button type="button" className="btn primary" disabled={!ready} onClick={() => void fileAll()}>
          {busy ? 'Filing' : `File all · ${packets.length} packet${packets.length === 1 ? '' : 's'}, ${order.length} sheet${order.length === 1 ? '' : 's'}`}
        </button>
      </div>
    </section>
  )
}
