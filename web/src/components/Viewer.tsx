// The scan viewer: a page opens over the current screen instead of in a new
// tab. Wheel or pinch to zoom, drag to pan, arrows to step through the
// pages it was opened with, R to turn it, 0 to fit, Escape or the browser's
// Back to close. A page can bring a partner (Compare: two children on the
// same side), which moves and zooms with it, and a panel of notes to read
// beside it.
//
// A page that knows its id can take comments: press C (or Comment), drag a
// box over the spot, write the comment, pick praise, fix or note. Comments
// are kept on the server as fractions of the page and drawn on the copy
// Claude reads when the packet is analysed again. Each comment shows as one
// label on the page: its words on a pale card the width of the box, with the
// number on the card's corner. The Aa control sets the words' size and face,
// or hides them; with the words hidden the box shows as an outline instead.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent as RWheelEvent } from 'react'
import { fitView, panBy, rotateView, toPageFraction, wheelFactor, zoomAt, type Size, type View } from './viewerMath'
import { del, get, post, put } from '../api'
import { ANNOTATION_KINDS, clampBox, KIND_COLOR, type Annotation, type AnnotationKind } from '../../../shared/annotations'
import { clampSize, fontFamily, loadMarkText, MARK_FONTS, MAX_SIZE, MIN_SIZE, saveMarkText, SIZE_STEP, type MarkTextStyle } from './markText'

export interface ViewerPage {
  src: string
  label: string
  sub?: string
  /** The page's id in the archive; with it, the viewer loads and takes comments. */
  pageId?: number
  /** A second page shown beside this one, sharing its zoom and pan. */
  pair?: { src: string; label: string }
  /** Notes to read beside the page. */
  panel?: ReactNode
}

const PAIR_GAP = 12

interface ViewerApi { open: (pages: ViewerPage[], index?: number) => void }
const Ctx = createContext<ViewerApi>({ open: () => {} })
export const useViewer = () => useContext(Ctx)

export function ViewerProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<{ pages: ViewerPage[]; index: number } | null>(null)
  // The viewer pushes one history entry so Back closes it. `closing` stops the
  // popstate handler and the Escape key from both acting on one close.
  const closing = useRef(false)
  const open = useCallback((pages: ViewerPage[], index = 0) => {
    if (!pages.length) return
    setState({ pages, index: Math.max(0, Math.min(index, pages.length - 1)) })
    if (location.hash !== '#view') history.pushState({ view: true }, '', '#view')
  }, [])
  const close = useCallback(() => {
    if (closing.current) return
    closing.current = true
    setState(null)
    if (location.hash === '#view') history.back()
    else closing.current = false
  }, [])
  useEffect(() => {
    const onPop = () => {
      if (location.hash !== '#view') { setState(null); closing.current = false }
    }
    window.addEventListener('popstate', onPop)
    // Landing on a URL that still carries #view (a reload) shows nothing to view: drop it.
    if (location.hash === '#view') history.replaceState(null, '', location.pathname + location.search)
    return () => window.removeEventListener('popstate', onPop)
  }, [])
  const api = useMemo(() => ({ open }), [open])
  return (
    <Ctx.Provider value={api}>
      {children}
      {state && <Overlay pages={state.pages} index={state.index} setIndex={(i) => setState((s) => (s ? { ...s, index: i } : s))} close={close} />}
    </Ctx.Provider>
  )
}

/** Wraps a thumbnail or picture so that clicking it opens the viewer on `pages` at `index`. `badge` shows a count, for comments. */
export function ScanLink({ pages, index = 0, children, title, style, badge }: { pages: ViewerPage[]; index?: number; children: ReactNode; title?: string; style?: React.CSSProperties; badge?: number }) {
  const { open } = useViewer()
  return (
    <button type="button" className="scanlink" onClick={() => open(pages, index)} title={title ?? 'Open the page here. Wheel to zoom, drag to move, Esc to close.'} style={{ position: 'relative', ...style }}>
      {children}
      {badge ? <span className="scanbadge" title={`${badge} comment${badge === 1 ? '' : 's'}`}>{badge}</span> : null}
    </button>
  )
}

type Box = { x: number; y: number; w: number; h: number }
type Editing = { id: number | null; box: Box; kind: AnnotationKind; text: string }
type Drawn = Box & { kind: AnnotationKind; n: number; id: number | null; active: boolean; text: string }

function Overlay({ pages, index, setIndex, close }: { pages: ViewerPage[]; index: number; setIndex: (i: number) => void; close: () => void }) {
  const page = pages[index]
  const stageRef = useRef<HTMLDivElement>(null)
  const [stage, setStage] = useState<Size>({ w: 0, h: 0 })
  const [img, setImg] = useState<Size | null>(null)
  const [rotate, setRotate] = useState(0)
  const [view, setView] = useState<View>({ x: 0, y: 0, s: 1 })
  const [fitted, setFitted] = useState(true)
  const [panel, setPanel] = useState(true)
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const pinch = useRef<{ dist: number; cx: number; cy: number } | null>(null)
  const dragged = useRef(false)
  // Whether the press began on the dark surround rather than the page. The
  // stage captures the pointer, so the click that follows reports the stage
  // as its target whatever was under the pointer; the press knows better.
  const downOnBackdrop = useRef(false)

  // Comments on this page, and the one being drawn or edited.
  const [marks, setMarks] = useState<Annotation[]>([])
  const [commenting, setCommenting] = useState(false)
  const [draft, setDraft] = useState<{ x0: number; y0: number; box: Box } | null>(null)
  const [editing, setEditing] = useState<Editing | null>(null)
  const [lastKind, setLastKind] = useState<AnnotationKind>('fix')
  const [err, setErr] = useState<string | null>(null)
  const canComment = page.pageId != null

  // How the comment text is drawn in its box, remembered across pages and visits.
  const [textStyle, setTextStyle] = useState<MarkTextStyle>(loadMarkText)
  const [textMenu, setTextMenu] = useState(false)
  const setText = (patch: Partial<MarkTextStyle>) => setTextStyle((t) => { const n = { ...t, ...patch, size: clampSize(patch.size ?? t.size) }; saveMarkText(n); return n })

  const loadMarks = useCallback(() => {
    if (page.pageId == null) return setMarks([])
    get<Annotation[]>(`/api/pages/${page.pageId}/annotations`).then(setMarks).catch(() => setMarks([]))
  }, [page.pageId])
  useEffect(() => { loadMarks(); setEditing(null); setDraft(null) }, [loadMarks])

  // The size one picture has to fit in: the stage, or half of it less the gap when two sit side by side.
  const paired = !!page.pair
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ w: paired ? (el.clientWidth - PAIR_GAP) / 2 : el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [panel, paired])

  // A new page starts fitted and upright.
  useEffect(() => { setImg(null); setRotate(0); setFitted(true) }, [page.src])
  useEffect(() => {
    if (img && fitted) setView(fitView(stage, img, rotate))
  }, [img, stage, rotate, fitted])

  // Neighbours load in the background so the arrows feel instant.
  useEffect(() => {
    for (const i of [index - 1, index + 1]) {
      const p = pages[i]
      if (!p) continue
      new Image().src = p.src
      if (p.pair) new Image().src = p.pair.src
    }
  }, [index, pages])

  // Nothing behind the viewer scrolls while it is up.
  useEffect(() => {
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = prev }
  }, [])

  const step = useCallback((d: number) => {
    const next = index + d
    if (next >= 0 && next < pages.length) setIndex(next)
  }, [index, pages.length, setIndex])
  const turn = useCallback(() => {
    setRotate((r) => {
      const to = (r + 90) % 360
      if (img && !fitted) setView((v) => rotateView(v, stage, img, r, to))
      return to
    })
  }, [img, fitted, stage])
  const fit = useCallback(() => setFitted(true), [])
  const zoomCentre = useCallback((factor: number) => {
    setFitted(false)
    setView((v) => zoomAt(v, factor, stage.w / 2, stage.h / 2))
  }, [stage])

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement | null
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT')) return
      if (e.key === 'Escape') {
        e.preventDefault()
        if (textMenu) setTextMenu(false)
        else if (editing) setEditing(null)
        else if (draft) setDraft(null)
        else if (commenting) setCommenting(false)
        else close()
      }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J' || e.key === 'PageDown') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K' || e.key === 'PageUp') { e.preventDefault(); step(-1) }
      else if (e.key === 'r' || e.key === 'R') turn()
      else if (e.key === '0' || e.key === 'f' || e.key === 'F') fit()
      else if (e.key === '+' || e.key === '=') zoomCentre(1.25)
      else if (e.key === '-' || e.key === '_') zoomCentre(0.8)
      else if (e.key === 'n' || e.key === 'N') setPanel((p) => !p)
      else if ((e.key === 'c' || e.key === 'C') && canComment) setCommenting((c) => !c)
      else if ((e.key === 't' || e.key === 'T') && canComment) setText({ show: !textStyle.show })
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, step, turn, fit, zoomCentre, canComment, editing, draft, commenting, textMenu, textStyle.show])

  function stagePoint(e: { clientX: number; clientY: number }) {
    const r = stageRef.current!.getBoundingClientRect()
    let x = e.clientX - r.left
    // Over the right-hand partner, measure from that pane's own left edge: the two share one view.
    if (paired && x > stage.w + PAIR_GAP / 2) x -= stage.w + PAIR_GAP
    return { x, y: e.clientY - r.top }
  }
  // The point on the upright page under the pointer, as fractions, or null off the page.
  function pagePoint(e: { clientX: number; clientY: number }) {
    if (!img) return null
    const p = stagePoint(e)
    const { fx, fy } = toPageFraction(p.x, p.y, view, img, rotate)
    return { fx: Math.max(0, Math.min(1, fx)), fy: Math.max(0, Math.min(1, fy)), on: fx >= 0 && fx <= 1 && fy >= 0 && fy <= 1 }
  }
  function onWheel(e: RWheelEvent) {
    e.preventDefault()
    const p = stagePoint(e)
    setFitted(false)
    setView((v) => zoomAt(v, wheelFactor(e.deltaY, e.deltaMode), p.x, p.y))
  }
  function onPointerDown(e: RPointerEvent) {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    dragged.current = false
    downOnBackdrop.current = !!(e.target as HTMLElement).dataset.backdrop
    if (commenting && pointers.current.size === 1 && !editing) {
      const pt = pagePoint(e)
      if (pt?.on) { setDraft({ x0: pt.fx, y0: pt.fy, box: { x: pt.fx, y: pt.fy, w: 0, h: 0 } }); return }
    }
    if (pointers.current.size === 2) {
      const [a, b] = [...pointers.current.values()]
      const mid = stagePoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      pinch.current = { dist: Math.hypot(a.x - b.x, a.y - b.y), cx: mid.x, cy: mid.y }
    }
  }
  function onPointerMove(e: RPointerEvent) {
    const prev = pointers.current.get(e.pointerId)
    if (!prev) return
    pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY })
    if (draft) {
      const pt = pagePoint(e)
      if (pt) setDraft({ ...draft, box: { x: Math.min(draft.x0, pt.fx), y: Math.min(draft.y0, pt.fy), w: Math.abs(pt.fx - draft.x0), h: Math.abs(pt.fy - draft.y0) } })
      dragged.current = true
      return
    }
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]
      const dist = Math.hypot(a.x - b.x, a.y - b.y)
      const mid = stagePoint({ clientX: (a.x + b.x) / 2, clientY: (a.y + b.y) / 2 })
      const { dist: d0, cx, cy } = pinch.current
      setFitted(false)
      setView((v) => panBy(zoomAt(v, dist / d0, cx, cy), mid.x - cx, mid.y - cy))
      pinch.current = { dist, cx: mid.x, cy: mid.y }
      dragged.current = true
      return
    }
    const dx = e.clientX - prev.x, dy = e.clientY - prev.y
    if (Math.abs(dx) + Math.abs(dy) > 2) dragged.current = true
    if (dragged.current) { setFitted(false); setView((v) => panBy(v, dx, dy)) }
  }
  function onPointerUp(e: RPointerEvent) {
    pointers.current.delete(e.pointerId)
    if (pointers.current.size < 2) pinch.current = null
    if (draft) {
      // A click rather than a drag drops a small box centred on the spot.
      let box = draft.box
      if (box.w < 0.01 && box.h < 0.01) box = { x: draft.x0 - 0.02, y: draft.y0 - 0.015, w: 0.04, h: 0.03 }
      setEditing({ id: null, box: clampBox(box), kind: lastKind, text: '' })
      setDraft(null)
    }
  }
  function onDoubleClick(e: React.MouseEvent) {
    if (commenting) return
    const p = stagePoint(e)
    if (!fitted) return fit()
    setFitted(false)
    setView((v) => zoomAt(v, 2.5, p.x, p.y))
  }
  // A click on the dark surround, not on the page, closes.
  function onBackdropClick(e: React.MouseEvent) {
    if (textMenu) { setTextMenu(false); return }
    if (dragged.current || commenting || editing) return
    if (downOnBackdrop.current && (e.target as HTMLElement).dataset.backdrop) close()
  }

  async function saveEditing() {
    if (!editing || page.pageId == null) return
    const text = editing.text.trim()
    if (!text) return setErr('Write the comment first.')
    try {
      setErr(null)
      if (editing.id == null) await post(`/api/pages/${page.pageId}/annotations`, { ...editing.box, kind: editing.kind, text })
      else await put(`/api/annotations/${editing.id}`, { kind: editing.kind, text })
      setLastKind(editing.kind)
      setEditing(null)
      loadMarks()
    } catch (e) { setErr((e as Error).message) }
  }
  async function removeEditing() {
    if (!editing || editing.id == null) return setEditing(null)
    try {
      await del(`/api/annotations/${editing.id}`)
      setEditing(null)
      loadMarks()
    } catch (e) { setErr((e as Error).message) }
  }
  const openMark = (m: Annotation) => setEditing({ id: m.id, box: { x: m.x, y: m.y, w: m.w, h: m.h }, kind: m.kind, text: m.text })

  const vis = img ? (rotate % 180 === 0 ? img : { w: img.h, h: img.w }) : null
  const pct = img ? Math.round(view.s * 100) : null
  const showPanel = panel && (!!page.panel || canComment)
  const cursor = commenting ? 'crosshair' : fitted ? 'zoom-in' : 'grab'
  // While a comment is being edited its box shows the words as they are typed.
  const drawn: Drawn[] = [
    ...marks.map((m, i) => ({ x: m.x, y: m.y, w: m.w, h: m.h, kind: m.kind, n: i + 1, id: m.id, active: editing?.id === m.id, text: editing?.id === m.id ? editing.text : m.text })),
    ...(draft ? [{ ...draft.box, kind: lastKind, n: marks.length + 1, id: null, active: true, text: '' }] : []),
    ...(editing && editing.id == null ? [{ ...editing.box, kind: editing.kind, n: marks.length + 1, id: null, active: true, text: editing.text }] : []),
  ]
  const textOn = textStyle.show ? textStyle : null

  return (
    <div className="viewer" role="dialog" aria-modal="true" aria-label={`${page.label}${page.sub ? `, ${page.sub}` : ''}`}>
      <div className="viewer-bar">
        <div className="col" style={{ gap: 0, minWidth: 0 }}>
          <div className="serif" style={{ fontSize: 18, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{page.label}{page.pair && <span style={{ fontWeight: 400, opacity: 0.7 }}> vs {page.pair.label}</span>}</div>
          {page.sub && <div className="small" style={{ opacity: 0.7 }}>{page.sub}</div>}
        </div>
        <div className="row" style={{ marginLeft: 'auto', gap: 6 }}>
          {pages.length > 1 && <span className="small" style={{ opacity: 0.7, marginRight: 6 }}>{index + 1} of {pages.length}</span>}
          <button className="vbtn" onClick={() => step(-1)} disabled={index === 0} title="Previous (←)" aria-label="Previous page">‹</button>
          <button className="vbtn" onClick={() => step(1)} disabled={index === pages.length - 1} title="Next (→)" aria-label="Next page">›</button>
          <button className="vbtn" onClick={() => zoomCentre(0.8)} title="Zoom out (−)" aria-label="Zoom out">−</button>
          <button className="vbtn" onClick={fit} title="Fit the whole page (0)" style={{ minWidth: 58 }}>{fitted ? 'Fit' : `${pct}%`}</button>
          <button className="vbtn" onClick={() => zoomCentre(1.25)} title="Zoom in (+)" aria-label="Zoom in">+</button>
          <button className="vbtn" onClick={turn} title="Turn the page (R)">Rotate</button>
          {canComment && <button className={`vbtn ${commenting ? 'on' : ''}`} onClick={() => setCommenting((c) => !c)} title="Drag a box over a spot and write a comment (C)">{commenting ? 'Commenting…' : `Comment${marks.length ? ` · ${marks.length}` : ''}`}</button>}
          {canComment && (
            <span style={{ position: 'relative' }}>
              <button className={`vbtn ${textMenu ? 'on' : ''}`} onClick={() => setTextMenu((m) => !m)} title="The comment text in its box: size and font, or hide it (T)" aria-haspopup="true" aria-expanded={textMenu} style={{ textTransform: 'none', letterSpacing: 0, fontSize: 12.5 }}>Aa</button>
              {textMenu && (
                <div className="text-menu" role="group" aria-label="Comment text" onPointerDown={(e) => e.stopPropagation()}>
                  <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                    <input type="checkbox" checked={textStyle.show} onChange={(e) => setText({ show: e.target.checked })} />
                    <span>Show the words in the box</span>
                  </label>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <span className="over quiet" style={{ fontSize: 10, width: 44 }}>Size</span>
                    <button type="button" className="btn" onClick={() => setText({ size: textStyle.size - SIZE_STEP })} disabled={textStyle.size <= MIN_SIZE} aria-label="Smaller text">−</button>
                    <input type="range" min={MIN_SIZE} max={MAX_SIZE} step={SIZE_STEP} value={textStyle.size} onChange={(e) => setText({ size: Number(e.target.value) })} aria-label="Text size" style={{ flex: 1 }} />
                    <button type="button" className="btn" onClick={() => setText({ size: textStyle.size + SIZE_STEP })} disabled={textStyle.size >= MAX_SIZE} aria-label="Larger text">+</button>
                    <span className="small" style={{ width: 34, textAlign: 'right' }}>{textStyle.size}px</span>
                  </div>
                  <div className="row" style={{ gap: 6, alignItems: 'center' }}>
                    <span className="over quiet" style={{ fontSize: 10, width: 44 }}>Font</span>
                    {MARK_FONTS.map((f) => (
                      <button key={f.font} type="button" className={`chip ${textStyle.font === f.font ? 'on' : ''}`} style={{ fontFamily: f.family, cursor: 'pointer' }} onClick={() => setText({ font: f.font })}>{f.label}</button>
                    ))}
                  </div>
                  <div className="mark-text" style={{ position: 'static', fontSize: textStyle.size, fontFamily: fontFamily(textStyle.font), color: KIND_COLOR.fix, maxWidth: 'none' }}>she go → she goes</div>
                </div>
              )}
            </span>
          )}
          {(page.panel || canComment) && <button className="vbtn" onClick={() => setPanel((p) => !p)} title="Show or hide the notes (N)">{panel ? 'Hide notes' : 'Notes'}</button>}
          <a className="vbtn" href={page.src} target="_blank" rel="noreferrer" title="The file itself, in a new tab">File</a>
          <button className="vbtn" onClick={close} title="Close (Esc)" aria-label="Close">✕</button>
        </div>
      </div>
      <div className="viewer-body">
        <div ref={stageRef} className="viewer-stage" data-backdrop="1" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick} onClick={onBackdropClick} style={{ cursor }}>
          {page.pair ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: PAIR_GAP, padding: 0 }}>
              <Pane src={page.src} view={view} rotate={rotate} img={img} vis={vis} onSize={setImg} marks={drawn} text={textOn} onMark={(id) => { const m = marks.find((x) => x.id === id); if (m) openMark(m) }} />
              <Pane src={page.pair.src} view={view} rotate={rotate} img={img} vis={vis} onSize={null} marks={[]} text={null} onMark={() => {}} />
            </div>
          ) : (
            <Pane src={page.src} view={view} rotate={rotate} img={img} vis={vis} onSize={setImg} marks={drawn} text={textOn} onMark={(id) => { const m = marks.find((x) => x.id === id); if (m) openMark(m) }} />
          )}
          {!img && <div className="viewer-loading">Loading</div>}
          {commenting && !editing && !draft && <div className="viewer-hint">Drag a box over the spot, or click it. Esc to stop commenting.</div>}
          {editing && (
            <div className="comment-editor" onPointerDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}>
              <div className="row" style={{ gap: 6 }}>
                {ANNOTATION_KINDS.map((k) => (
                  <button key={k.kind} type="button" className={`chip ${editing.kind === k.kind ? 'on' : ''}`} style={editing.kind === k.kind ? { background: KIND_COLOR[k.kind], borderColor: KIND_COLOR[k.kind] } : { color: KIND_COLOR[k.kind] }} title={k.hint} onClick={() => setEditing({ ...editing, kind: k.kind })}>{k.label}</button>
                ))}
                <span className="small" style={{ marginLeft: 'auto', opacity: 0.7 }}>{editing.id == null ? 'New comment' : 'Edit comment'}</span>
              </div>
              <textarea
                autoFocus
                value={editing.text}
                onChange={(e) => setEditing({ ...editing, text: e.target.value })}
                onKeyDown={(e) => { if (e.key === 'Escape') { e.stopPropagation(); setEditing(null) } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); void saveEditing() } }}
                rows={3}
                placeholder={editing.kind === 'fix' ? 'What is wrong here, in your words: "she go → she goes"' : editing.kind === 'praise' ? 'What is good here: "a full sentence with a capital and a full stop"' : 'Anything the analysis should know, or a question for it'}
              />
              <div className="row" style={{ gap: 8 }}>
                <button type="button" className="btn primary" onClick={() => void saveEditing()}>Save</button>
                <button type="button" className="btn" onClick={() => setEditing(null)}>Cancel</button>
                {editing.id != null && <button type="button" className="btn" style={{ marginLeft: 'auto' }} onClick={() => void removeEditing()}>Delete</button>}
                {err && <span className="err">{err}</span>}
              </div>
              <div className="muted small">Claude reads this with the page next time the packet is analysed. Ctrl+Enter saves.</div>
            </div>
          )}
        </div>
        {showPanel && (
          <aside className="viewer-panel">
            {page.panel}
            {canComment && (
              <div className="col" style={{ gap: 8 }}>
                <div className="over quiet" style={{ fontSize: 10 }}>Comments{marks.length ? ` · ${marks.length}` : ''}</div>
                {marks.length === 0 && <p className="muted small">None yet. Press C, then drag a box over a spot on the page. Praise is quoted in the student's note; a fix goes first in their fix-it table.</p>}
                {marks.map((m, i) => (
                  <button key={m.id} type="button" className="comment-row" onClick={() => openMark(m)} style={{ borderLeftColor: KIND_COLOR[m.kind] }}>
                    <span className="comment-n" style={{ background: KIND_COLOR[m.kind] }}>{i + 1}</span>
                    <span><span className="over quiet" style={{ fontSize: 9.5, marginRight: 6 }}>{m.kind}</span>{m.text}</span>
                  </button>
                ))}
              </div>
            )}
          </aside>
        )}
      </div>
      {pages.length > 1 && (
        <div className="viewer-strip">
          {pages.map((p, i) => <button key={`${p.src}-${i}`} className={`chip ${i === index ? 'on' : ''}`} onClick={() => setIndex(i)}>{p.label}</button>)}
        </div>
      )}
      <div className="viewer-keys small">
        <span><kbd className="key">←</kbd><kbd className="key">→</kbd> pages</span>
        <span>wheel or pinch zoom</span>
        <span>drag to move</span>
        <span><kbd className="key">R</kbd> rotate</span>
        <span><kbd className="key">0</kbd> fit</span>
        {canComment && <span><kbd className="key">C</kbd> comment</span>}
        {canComment && <span><kbd className="key">T</kbd> words on/off</span>}
        <span><kbd className="key">Esc</kbd> close</span>
      </div>
    </div>
  )
}

// One picture inside the stage, at the shared view. The pair shares the first
// picture's measured size, so two scans of the same sheet line up exactly.
// Comment boxes sit in a layer that turns with the picture, in page pixels,
// with strokes, badges and the words scaled down so they stay the same size
// on screen at any zoom. A comment with words showing is drawn as a single
// card: the words on a pale label as wide as the box, hung from the box's
// top-left corner with the number on its corner, and no outline round the
// box itself, so a note never looks like a window inside a window. A box
// with no words to show (words hidden, or still being drawn) keeps a thin
// outline with the number on its corner, so the spot is always marked.
function Pane({ src, view, rotate, img, vis, onSize, marks, text, onMark }: {
  src: string; view: View; rotate: number; img: Size | null; vis: Size | null; onSize: ((s: Size) => void) | null
  marks: Drawn[]; text: MarkTextStyle | null; onMark: (id: number) => void
}) {
  const inner = { position: 'absolute' as const, left: vis && img ? (vis.w - img.w) / 2 : 0, top: vis && img ? (vis.h - img.h) / 2 : 0, width: img?.w ?? 0, height: img?.h ?? 0, transform: `rotate(${rotate}deg)` }
  const k = 1 / view.s
  return (
    <div style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }} data-backdrop="1">
      <div style={{ position: 'absolute', left: 0, top: 0, width: vis?.w ?? 0, height: vis?.h ?? 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0', willChange: 'transform', visibility: img ? 'visible' : 'hidden' }}>
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => onSize?.({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ ...inner, width: img?.w ?? 'auto', height: img?.h ?? 'auto', background: '#fff', boxShadow: '0 2px 18px rgba(0,0,0,.45)', userSelect: 'none' }}
        />
        {img && marks.length > 0 && (
          <div style={{ ...inner, pointerEvents: 'none' }}>
            {marks.map((m) => {
              const c = KIND_COLOR[m.kind]
              const labelled = !!text && m.text.trim() !== ''
              const ring = m.active ? `0 0 0 ${3 * k}px ${c}55` : undefined
              return (
                <div
                  key={m.id ?? `draft-${m.n}`}
                  className="mark"
                  onPointerDown={(e) => { if (m.id != null) { e.stopPropagation(); } }}
                  onClick={(e) => { if (m.id != null) { e.stopPropagation(); onMark(m.id) } }}
                  style={labelled
                    ? { left: m.x * img.w, top: m.y * img.h, width: m.w * img.w, height: m.h * img.h, border: 'none', pointerEvents: m.id != null ? 'auto' : 'none' }
                    : { left: m.x * img.w, top: m.y * img.h, width: m.w * img.w, height: m.h * img.h, borderColor: c, borderWidth: Math.max(1, 2 * k), background: `${c}${m.active ? '26' : '0f'}`, boxShadow: ring, pointerEvents: m.id != null ? 'auto' : 'none', borderRadius: 3 * k }}
                >
                  {labelled && (
                    <div
                      className="mark-text"
                      style={{
                        // In the scaled-down layer one unit is one screen pixel, so the box's screen width is its page width over k.
                        transform: `scale(${k})`, transformOrigin: '0 0', left: 0, top: 0,
                        width: Math.max(140, (m.w * img.w) / k), maxWidth: Math.max(140, (img.w - m.x * img.w) / k),
                        fontSize: text!.size, fontFamily: fontFamily(text!.font), color: c, borderColor: `${c}66`, boxShadow: ring ?? '0 1px 4px rgba(0,0,0,.18)',
                        pointerEvents: m.id != null ? 'auto' : 'none',
                      }}
                    >{m.text}</div>
                  )}
                  <span className="mark-n" style={{ background: c, transform: `scale(${k})`, transformOrigin: '0 0', left: (labelled ? -6 : -1) * k, top: (labelled ? -6 : -1) * k }}>{m.n}</span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
