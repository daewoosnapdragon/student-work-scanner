// A comment the teacher pins to a spot on a scanned page. Its box is kept as
// fractions of the upright page (0 to 1 from the left and the top), so it
// lands in the same place at any zoom, in any viewer, and on the copy of the
// page that Claude reads.

export type AnnotationKind = 'praise' | 'fix' | 'note'

export interface Annotation {
  id: number
  pageId: number
  x: number
  y: number
  w: number
  h: number
  kind: AnnotationKind
  text: string
  createdAt: string
}

export const ANNOTATION_KINDS: Array<{ kind: AnnotationKind; label: string; hint: string }> = [
  { kind: 'praise', label: 'Praise', hint: 'Something done well. The student\'s note quotes it.' },
  { kind: 'fix', label: 'Fix', hint: 'A mistake to work on. Goes in the fix-it table first.' },
  { kind: 'note', label: 'Note', hint: 'Context for the analysis, or for you.' },
]
export const KIND_LABEL: Record<AnnotationKind, string> = { praise: 'praise', fix: 'fix', note: 'note' }
/** Ink colours for the boxes, shared by the web viewer and the marked copy sent to Claude. */
export const KIND_COLOR: Record<AnnotationKind, string> = { praise: '#2f7d4f', fix: '#8b1e1e', note: '#b8860b' }

export function isKind(k: unknown): k is AnnotationKind {
  return k === 'praise' || k === 'fix' || k === 'note'
}

/** Keeps a box inside the page and at least a sliver in size, with x,y its top-left corner. */
export function clampBox(b: { x: number; y: number; w: number; h: number }) {
  const min = 0.005
  let x = Math.min(b.x, b.x + b.w), y = Math.min(b.y, b.y + b.h)
  let w = Math.abs(b.w), h = Math.abs(b.h)
  x = Math.max(0, Math.min(1 - min, x))
  y = Math.max(0, Math.min(1 - min, y))
  w = Math.max(min, Math.min(1 - x, w))
  h = Math.max(min, Math.min(1 - y, h))
  return { x: round(x), y: round(y), w: round(w), h: round(h) }
}
const round = (n: number) => Math.round(n * 10000) / 10000

/** Where on the page a box sits, in words: "near the top left", "in the middle, to the right". */
export function describePlace(b: { x: number; y: number; w: number; h: number }): string {
  const cx = b.x + b.w / 2, cy = b.y + b.h / 2
  const row = cy < 1 / 3 ? 'top' : cy < 2 / 3 ? 'middle' : 'bottom'
  const col = cx < 1 / 3 ? 'left' : cx < 2 / 3 ? 'centre' : 'right'
  const big = b.w > 0.6 && b.h > 0.6 ? 'most of the page' : b.w > 0.6 ? `a band across the ${row}` : null
  if (big) return big
  if (row === 'middle' && col === 'centre') return 'in the middle of the page'
  if (row === 'middle') return `in the middle, to the ${col}`
  if (col === 'centre') return `near the ${row}, in the centre`
  return `near the ${row} ${col}`
}

/**
 * The teacher's marks on one side as text for the prompt, numbered to match
 * the boxes drawn on the picture. Empty string when there are none.
 */
export function annotationsText(list: Annotation[], sideName: string): string {
  if (!list.length) return ''
  const lines = list.map((a, i) => `${i + 1}. [${KIND_LABEL[a.kind]}] ${describePlace(a)}: ${a.text.trim()}`)
  return `The teacher's marks on ${sideName}, numbered as the boxes drawn on it (the boxes are the teacher's, not the child's work):\n${lines.join('\n')}`
}
