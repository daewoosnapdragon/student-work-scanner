import type { PageRef, Side } from '../shared/types.js'

// The QR code printed in the corner of every sheet. Version 1 looks like
//   SWS1:S07:W23:2B
// student code, assignment code, sheet number plus side (A = front, B = back).
// Colons and upper case keep the text within the QR alphanumeric set, which
// is a smaller code (version 2, not 3) and so bigger modules at the same
// printed size. Sets printed before 2026-11 separate with | and read the same.
export const CODE_PREFIX = 'SWS1'

export function formatCode(ref: PageRef): string {
  return `${CODE_PREFIX}:${ref.student}:${ref.assignment}:${ref.page}${ref.side}`.toUpperCase()
}

export function parseCode(text: string | null | undefined): PageRef | null {
  if (!text) return null
  const parts = text.trim().toUpperCase().split(/[|:]/).map((p) => p.trim())
  if (parts.length !== 4 || parts[0] !== CODE_PREFIX) return null
  const [, student, assignment, pageSide] = parts
  if (!/^[A-Z0-9-]{1,12}$/.test(student) || !/^[A-Z0-9-]{1,12}$/.test(assignment)) return null
  const m = /^(\d{1,2})([AB])$/.exec(pageSide)
  if (!m) return null
  const page = Number(m[1])
  if (page < 1) return null
  return { student, assignment, page, side: m[2].toLowerCase() as Side }
}

export function sideLabel(page: number, side: Side): string {
  return `${page} ${side === 'a' ? 'front' : 'back'}`
}

export function shortSide(page: number, side: Side): string {
  return `${page}${side}`
}

// Every side an assignment expects, in scan order.
export function expectedSides(sheets: number, twoSided: boolean): Array<{ page: number; side: Side }> {
  const out: Array<{ page: number; side: Side }> = []
  for (let p = 1; p <= sheets; p++) {
    out.push({ page: p, side: 'a' })
    if (twoSided) out.push({ page: p, side: 'b' })
  }
  return out
}
