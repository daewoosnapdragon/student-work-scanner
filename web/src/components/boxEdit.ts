// Moving and resizing a comment's box once it is drawn, kept apart from
// React so it can be tested. Boxes are fractions of the upright page, as
// they are stored, and every result is clamped back inside the page.
import { clampBox } from '../../../shared/annotations'

export type Box = { x: number; y: number; w: number; h: number }
/** The eight grab points round a box, named by compass side. */
export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']

/** How far one arrow press moves or grows a box, as a fraction of the page. */
export const NUDGE = 0.004

/** The box shifted by (dx, dy), kept whole: it slides along the page's edge rather than shrinking against it. */
export function moveBox(b: Box, dx: number, dy: number): Box {
  const x = Math.max(0, Math.min(1 - b.w, b.x + dx))
  const y = Math.max(0, Math.min(1 - b.h, b.y + dy))
  return clampBox({ x, y, w: b.w, h: b.h })
}

/** The box with the named side or corner pulled by (dx, dy). Pulling a side past its opposite flips the box rather than inverting it. */
export function resizeBox(b: Box, handle: Handle, dx: number, dy: number): Box {
  let left = b.x, right = b.x + b.w, top = b.y, bottom = b.y + b.h
  if (handle.includes('w')) left += dx
  if (handle.includes('e')) right += dx
  if (handle.includes('n')) top += dy
  if (handle.includes('s')) bottom += dy
  return clampBox({ x: left, y: top, w: right - left, h: bottom - top })
}

/** The CSS cursor for a handle on an upright page. */
export function handleCursor(h: Handle): string {
  if (h === 'n' || h === 's') return 'ns-resize'
  if (h === 'e' || h === 'w') return 'ew-resize'
  return h === 'ne' || h === 'sw' ? 'nesw-resize' : 'nwse-resize'
}

/** Where a handle sits on a box of `w` by `h` page pixels, as its centre. */
export function handleAt(h: Handle, w: number, hgt: number): { x: number; y: number } {
  const x = h.includes('w') ? 0 : h.includes('e') ? w : w / 2
  const y = h.includes('n') ? 0 : h.includes('s') ? hgt : hgt / 2
  return { x, y }
}

/**
 * An arrow key applied to the box: plain, it moves the box one step;
 * with `resize`, Right and Down grow it and Left and Up shrink it, from
 * the bottom-right corner. Null for any other key.
 */
export function nudgeBox(b: Box, key: string, resize: boolean, step = NUDGE): Box | null {
  const d = key === 'ArrowLeft' ? { x: -step, y: 0 } : key === 'ArrowRight' ? { x: step, y: 0 } : key === 'ArrowUp' ? { x: 0, y: -step } : key === 'ArrowDown' ? { x: 0, y: step } : null
  if (!d) return null
  return resize ? resizeBox(b, 'se', d.x, d.y) : moveBox(b, d.x, d.y)
}
