// The scan viewer: a page opens over the current screen instead of in a new
// tab. Wheel or pinch to zoom, drag to pan, arrows to step through the
// pages it was opened with, R to turn it, 0 to fit, Escape or the browser's
// Back to close. A page can bring a partner (Compare: two children on the
// same side), which moves and zooms with it, and a panel of notes to read
// beside it.
import { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent, type ReactNode, type WheelEvent as RWheelEvent } from 'react'
import { fitView, panBy, rotateView, wheelFactor, zoomAt, type Size, type View } from './viewerMath'

export interface ViewerPage {
  src: string
  label: string
  sub?: string
  /** A second page shown beside this one, sharing its zoom and pan. */
  pair?: { src: string; label: string }
  /** Notes to read beside the page. */
  panel?: ReactNode
}

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

/** Wraps a thumbnail or picture so that clicking it opens the viewer on `pages` at `index`. */
export function ScanLink({ pages, index = 0, children, title, style }: { pages: ViewerPage[]; index?: number; children: ReactNode; title?: string; style?: React.CSSProperties }) {
  const { open } = useViewer()
  return (
    <button type="button" className="scanlink" onClick={() => open(pages, index)} title={title ?? 'Open the page here. Wheel to zoom, drag to move, Esc to close.'} style={style}>
      {children}
    </button>
  )
}

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

  // The stage's size, kept current as the window changes.
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [panel, page.pair])

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
      if (e.key === 'Escape') { e.preventDefault(); close() }
      else if (e.key === 'ArrowRight' || e.key === 'ArrowDown' || e.key === 'j' || e.key === 'J' || e.key === 'PageDown') { e.preventDefault(); step(1) }
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp' || e.key === 'k' || e.key === 'K' || e.key === 'PageUp') { e.preventDefault(); step(-1) }
      else if (e.key === 'r' || e.key === 'R') turn()
      else if (e.key === '0' || e.key === 'f' || e.key === 'F') fit()
      else if (e.key === '+' || e.key === '=') zoomCentre(1.25)
      else if (e.key === '-' || e.key === '_') zoomCentre(0.8)
      else if (e.key === 'n' || e.key === 'N') setPanel((p) => !p)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close, step, turn, fit, zoomCentre])

  function stagePoint(e: { clientX: number; clientY: number }) {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
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
  }
  function onDoubleClick(e: React.MouseEvent) {
    const p = stagePoint(e)
    if (!fitted) return fit()
    setFitted(false)
    setView((v) => zoomAt(v, 2.5, p.x, p.y))
  }
  // A click on the dark surround, not on the page, closes.
  function onBackdropClick(e: React.MouseEvent) {
    if (dragged.current) return
    if ((e.target as HTMLElement).dataset.backdrop) close()
  }

  const vis = img ? (rotate % 180 === 0 ? img : { w: img.h, h: img.w }) : null
  const pct = img ? Math.round(view.s * 100) : null
  const showPanel = panel && !!page.panel

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
          {page.panel && <button className="vbtn" onClick={() => setPanel((p) => !p)} title="Show or hide the notes (N)">{panel ? 'Hide notes' : 'Notes'}</button>}
          <a className="vbtn" href={page.src} target="_blank" rel="noreferrer" title="The file itself, in a new tab">File</a>
          <button className="vbtn" onClick={close} title="Close (Esc)" aria-label="Close">✕</button>
        </div>
      </div>
      <div className="viewer-body">
        <div ref={stageRef} className="viewer-stage" data-backdrop="1" onWheel={onWheel} onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onDoubleClick={onDoubleClick} onClick={onBackdropClick} style={{ cursor: fitted ? 'zoom-in' : 'grab' }}>
          {page.pair ? (
            <div style={{ position: 'absolute', inset: 0, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, padding: 0 }}>
              <Pane src={page.src} view={view} rotate={rotate} img={img} vis={vis} onSize={setImg} />
              <Pane src={page.pair.src} view={view} rotate={rotate} img={img} vis={vis} onSize={null} />
            </div>
          ) : (
            <Pane src={page.src} view={view} rotate={rotate} img={img} vis={vis} onSize={setImg} />
          )}
          {!img && <div className="viewer-loading">Loading</div>}
        </div>
        {showPanel && <aside className="viewer-panel">{page.panel}</aside>}
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
        <span><kbd className="key">Esc</kbd> close</span>
      </div>
    </div>
  )
}

// One picture inside the stage, at the shared view. The pair shares the first
// picture's measured size, so two scans of the same sheet line up exactly.
function Pane({ src, view, rotate, img, vis, onSize }: { src: string; view: View; rotate: number; img: Size | null; vis: Size | null; onSize: ((s: Size) => void) | null }) {
  return (
    <div style={{ position: 'relative', overflow: 'hidden', width: '100%', height: '100%' }} data-backdrop="1">
      <div style={{ position: 'absolute', left: 0, top: 0, width: vis?.w ?? 0, height: vis?.h ?? 0, transform: `translate(${view.x}px, ${view.y}px) scale(${view.s})`, transformOrigin: '0 0', willChange: 'transform', visibility: img ? 'visible' : 'hidden' }}>
        <img
          src={src}
          alt=""
          draggable={false}
          onLoad={(e) => onSize?.({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
          style={{ position: 'absolute', left: vis && img ? (vis.w - img.w) / 2 : 0, top: vis && img ? (vis.h - img.h) / 2 : 0, width: img?.w ?? 'auto', height: img?.h ?? 'auto', transform: `rotate(${rotate}deg)`, background: '#fff', boxShadow: '0 2px 18px rgba(0,0,0,.45)', userSelect: 'none' }}
        />
      </div>
    </div>
  )
}
