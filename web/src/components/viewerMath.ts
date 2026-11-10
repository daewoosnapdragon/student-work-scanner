// The geometry behind the scan viewer, kept apart from React so it can be
// tested. The picture sits at the stage's top-left corner and is moved by a
// transform: translate(x, y) then scale(s). Rotation happens inside that box,
// so a page turned 90° simply has its width and height swapped here.

export interface View { x: number; y: number; s: number }
export interface Size { w: number; h: number }

export const MIN_SCALE = 0.15
export const MAX_SCALE = 10

/** The size the page takes on screen at scale 1, turned by `rotate` degrees. */
export function turned(img: Size, rotate: number): Size {
  return rotate % 180 === 0 ? { ...img } : { w: img.h, h: img.w }
}

/** Fits the whole page inside the stage with a little air, centred. */
export function fitView(stage: Size, img: Size, rotate: number, air = 0.96): View {
  const v = turned(img, rotate)
  if (!stage.w || !stage.h || !v.w || !v.h) return { x: 0, y: 0, s: 1 }
  const s = Math.min(stage.w / v.w, stage.h / v.h) * air
  return { x: (stage.w - v.w * s) / 2, y: (stage.h - v.h * s) / 2, s }
}

/** Scales by `factor` about the stage point (cx, cy), so what is under the cursor stays put. */
export function zoomAt(view: View, factor: number, cx: number, cy: number): View {
  const s = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.s * factor))
  const k = s / view.s
  return { x: cx - (cx - view.x) * k, y: cy - (cy - view.y) * k, s }
}

export function panBy(view: View, dx: number, dy: number): View {
  return { ...view, x: view.x + dx, y: view.y + dy }
}

/** Scale and translate that keep the page's centre where it was when it turns 90°. */
export function rotateView(view: View, stage: Size, img: Size, fromRotate: number, toRotate: number): View {
  const a = turned(img, fromRotate)
  const b = turned(img, toRotate)
  const cx = view.x + (a.w * view.s) / 2
  const cy = view.y + (a.h * view.s) / 2
  return { x: cx - (b.w * view.s) / 2, y: cy - (b.h * view.s) / 2, s: view.s }
}

/** A wheel tick to a zoom factor: a smooth curve for trackpads, bigger steps for mouse wheels. */
export function wheelFactor(deltaY: number, deltaMode: number): number {
  const px = deltaMode === 1 ? deltaY * 16 : deltaMode === 2 ? deltaY * 400 : deltaY
  return Math.exp(-px * 0.0022)
}
