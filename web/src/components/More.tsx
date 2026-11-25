import { useEffect, useRef, useState, type ReactNode } from 'react'

/** A "More ▾" button that opens a small card of links and buttons. It closes on Escape, on a click outside, and after any item is chosen. */
export default function More({ children, label = 'More' }: { children: ReactNode; label?: string }) {
  const [open, setOpen] = useState(false)
  const box = useRef<HTMLSpanElement>(null)
  const button = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { setOpen(false); button.current?.focus() } }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <span ref={box} className="more">
      <button ref={button} type="button" className="btn" aria-haspopup="true" aria-expanded={open} onClick={() => setOpen((v) => !v)}>{label} ▾</button>
      {open && <div className="more-menu card" onClick={(e) => { if ((e.target as HTMLElement).closest('a, button')) setOpen(false) }}>{children}</div>}
    </span>
  )
}
