// How the comment text is drawn inside its box on the page: whether at all,
// how big, and in which face. The choice is the teacher's, kept in the
// browser, and the same for every page. Sizes are screen pixels: the text
// stays readable at any zoom instead of growing and shrinking with the scan.

export type MarkFont = 'sans' | 'serif' | 'hand' | 'mono'

export interface MarkTextStyle {
  show: boolean
  size: number
  font: MarkFont
}

export const MIN_SIZE = 9
export const MAX_SIZE = 32
export const SIZE_STEP = 1
export const DEFAULT_MARK_TEXT: MarkTextStyle = { show: true, size: 13, font: 'sans' }

export const MARK_FONTS: Array<{ font: MarkFont; label: string; family: string }> = [
  { font: 'sans', label: 'Sans', family: "'IBM Plex Sans','Noto Sans KR',system-ui,sans-serif" },
  { font: 'serif', label: 'Serif', family: "'Playfair Display',Georgia,'Times New Roman',serif" },
  { font: 'hand', label: 'Hand', family: "'Segoe Print','Bradley Hand','Comic Sans MS','Chalkboard SE',cursive" },
  { font: 'mono', label: 'Mono', family: "'IBM Plex Mono',Consolas,'Courier New',monospace" },
]

export function fontFamily(font: MarkFont): string {
  return (MARK_FONTS.find((f) => f.font === font) ?? MARK_FONTS[0]).family
}

export function isMarkFont(f: unknown): f is MarkFont {
  return MARK_FONTS.some((x) => x.font === f)
}

export function clampSize(n: unknown): number {
  const v = typeof n === 'number' && Number.isFinite(n) ? Math.round(n) : DEFAULT_MARK_TEXT.size
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, v))
}

/** A style from whatever was stored, falling back field by field to the default. */
export function parseMarkText(raw: unknown): MarkTextStyle {
  let o: unknown = raw
  if (typeof raw === 'string') {
    try { o = JSON.parse(raw) } catch { o = null }
  }
  if (!o || typeof o !== 'object') return { ...DEFAULT_MARK_TEXT }
  const r = o as Record<string, unknown>
  return {
    show: typeof r.show === 'boolean' ? r.show : DEFAULT_MARK_TEXT.show,
    size: clampSize(r.size),
    font: isMarkFont(r.font) ? r.font : DEFAULT_MARK_TEXT.font,
  }
}

export const STORAGE_KEY = 'sws.markText'

export function loadMarkText(): MarkTextStyle {
  try { return parseMarkText(localStorage.getItem(STORAGE_KEY)) } catch { return { ...DEFAULT_MARK_TEXT } }
}
export function saveMarkText(s: MarkTextStyle) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* private window or storage off: the choice lasts the session */ }
}
