import type { Guess, Page, Side } from '../shared/types.js'
import { expectedSides, sideLabel } from './codes.js'
import { getAssignment, getStudent, hasSide, neighbourPages } from './db.js'

// A page whose code did not read still arrived somewhere in the stack. The
// pages scanned just before and after it say whose packet it most likely
// belongs to, and which side that packet is still missing.
export function guessesFor(page: Page): Guess[] {
  const neighbours = neighbourPages(page.seq, 3).filter((n) => n.status === 'filed' && n.student && n.assignment)
  const before = neighbours.filter((n) => n.seq < page.seq).sort((a, b) => b.seq - a.seq)
  const after = neighbours.filter((n) => n.seq > page.seq).sort((a, b) => a.seq - b.seq)

  const candidates = new Map<string, { student: string; assignment: string; why: string[]; score: number }>()
  const add = (n: Page, why: string, score: number) => {
    const key = `${n.student}|${n.assignment}`
    const c = candidates.get(key) ?? { student: n.student!, assignment: n.assignment!, why: [], score: 0 }
    c.why.push(why)
    c.score += score
    candidates.set(key, c)
  }
  before.forEach((n, i) => add(n, i === 0 ? 'scanned right before this page' : 'scanned shortly before', 3 - i))
  after.forEach((n, i) => add(n, i === 0 ? 'scanned right after this page' : 'scanned shortly after', 2 - i * 0.5))

  const guesses: Guess[] = []
  // A code that read cleanly but could not be filed (a rescan, usually) is
  // itself the best guess: filing it replaces the side already there.
  if (page.student && page.assignment && page.page && page.side) {
    const s = getStudent(page.student)
    guesses.push({ rank: 0, student: page.student, studentName: s?.name ?? page.student, assignment: page.assignment, page: page.page, side: page.side, why: 'What the code says. Filing it replaces the scan already there.' })
    ;(guesses[0] as any)._score = 100
    candidates.delete(`${page.student}|${page.assignment}`)
  }
  for (const c of candidates.values()) {
    const a = getAssignment(c.assignment)
    const s = getStudent(c.student)
    const expected = a ? expectedSides(a.sheets, !!a.twoSided) : [{ page: 1, side: 'a' as Side }]
    const missing = expected.filter((e) => !hasSide(c.student, c.assignment, e.page, e.side))
    let page: number | null = null
    let side: Side | null = null
    let why = c.why[0]
    if (missing.length === 1) {
      page = missing[0].page
      side = missing[0].side
      why = `${capital(c.why[0])}; this is the one side still missing, so it would complete the packet`
      c.score += 4
    } else if (missing.length > 1) {
      // The side that would come next in scan order after the neighbour before us.
      const prev = before.find((n) => n.student === c.student && n.assignment === c.assignment)
      const next = prev ? expected[expected.findIndex((e) => e.page === prev.page && e.side === prev.side) + 1] : undefined
      const pick = (next && missing.find((m) => m.page === next.page && m.side === next.side)) ?? missing[0]
      page = pick.page
      side = pick.side
      why = `${capital(c.why[0])}; packet still needs ${missing.map((m) => sideLabel(m.page, m.side)).join(', ')}`
      c.score += 1
    } else {
      why = `${capital(c.why[0])}, but that packet already has every side`
      c.score -= 3
    }
    guesses.push({ rank: 0, student: c.student, studentName: s?.name ?? c.student, assignment: c.assignment, page, side, why: why + '.' })
    ;(guesses[guesses.length - 1] as any)._score = c.score
  }
  guesses.sort((a, b) => (b as any)._score - (a as any)._score)
  const top = guesses.slice(0, 2).map((g, i) => {
    delete (g as any)._score
    return { ...g, rank: i + 1 }
  })
  top.push({ rank: top.length + 1, student: null, studentName: null, assignment: null, page: null, side: null, why: 'Someone else. Type a name or code.' })
  return top
}

function capital(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}
