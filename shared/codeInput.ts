import type { Assignment, PageRef, Side } from './types.js'
import { parseExpect } from './types.js'

// What the teacher types when the QR did not read: the label under the code
// says "S07 · W23 · 2 back", and any loose spelling of that is accepted:
//   S07 W23 2b   s07 w23 2 back   SWS1:S07:W23:2B   S07 W23 back   S07 W23
// Student and assignment codes first, then the side as the label shows it.
export function parseLooseCode(text: string | null | undefined): PageRef | null {
  if (!text) return null
  const parts = text.trim().toUpperCase().split(/[\s:|·,/]+/).filter(Boolean)
  if (parts[0] === 'SWS1') parts.shift()
  if (parts.length < 2 || parts.length > 4) return null
  const [student, assignment, ...rest] = parts
  const codeLike = /^[A-Z0-9-]{1,12}$/
  if (!codeLike.test(student) || !codeLike.test(assignment)) return null
  // the student code carries a digit (S07, 4S18), which a first name does not
  if (!/\d/.test(student) || !/\d/.test(assignment)) return null
  const tail = rest.join(' ')
  let page = 1
  let side: Side = 'a'
  if (tail) {
    const m = /^(\d{1,2})?\s*(A|B|FRONT|BACK)?$/.exec(tail)
    if (!m || (!m[1] && !m[2])) return null
    if (m[1]) page = Number(m[1])
    if (m[2]) side = m[2] === 'A' || m[2] === 'FRONT' ? 'a' : 'b'
  }
  if (page < 1) return null
  return { student, assignment, page, side }
}

// Every side an assignment waits for, in scan order: the same list the server
// keeps, for the web app's side chooser.
export function sidesOf(a: Pick<Assignment, 'sheets' | 'twoSided' | 'sides' | 'expect'>): Array<{ page: number; side: Side }> {
  const chosen = parseExpect(a.expect)
  if (chosen.length) return chosen
  const all: Array<{ page: number; side: Side }> = []
  for (let p = 1; p <= a.sheets; p++) {
    all.push({ page: p, side: 'a' })
    if (a.twoSided) all.push({ page: p, side: 'b' })
  }
  return a.sides && a.sides > 0 && a.sides < all.length ? all.slice(0, a.sides) : all
}
