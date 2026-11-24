import type { Side } from '../../../shared/types'

export type SideRef = { page: number; side: Side }
export type Placement = { student: string; page: number; side: Side }
export type Placements = Map<number, Placement>

const key = (s: SideRef) => `${s.page}${s.side}`

// Sides of one student that are spoken for: filed already, or given to another page in this sort.
function taken(placements: Placements, student: string, filed: Set<string>, except?: number): Set<string> {
  const t = new Set(filed)
  for (const [id, p] of placements) if (p.student === student && id !== except) t.add(key(p))
  return t
}

// Pages dropped on a student take the sides still open, in scan order; once
// every side is spoken for, the extra pages go on the first side again (a
// rescan, which replaces when filed) so nothing is silently dropped.
export function place(placements: Placements, pageIds: number[], student: string, sides: SideRef[], filed: Set<string>): Placements {
  const next = new Map(placements)
  for (const id of pageIds) next.delete(id)
  for (const id of pageIds) {
    const t = taken(next, student, filed)
    const open = sides.find((s) => !t.has(key(s))) ?? sides[0] ?? { page: 1, side: 'a' as Side }
    next.set(id, { student, page: open.page, side: open.side })
  }
  return next
}

export function unplace(placements: Placements, pageIds: number[]): Placements {
  const next = new Map(placements)
  for (const id of pageIds) next.delete(id)
  return next
}

// Clicking a placed page's side moves it to the next side of the assignment, round and round.
export function cycleSide(placements: Placements, pageId: number, sides: SideRef[]): Placements {
  const p = placements.get(pageId)
  if (!p || !sides.length) return placements
  const i = sides.findIndex((s) => s.page === p.page && s.side === p.side)
  const s = sides[(i + 1) % sides.length]
  const next = new Map(placements)
  next.set(pageId, { ...p, page: s.page, side: s.side })
  return next
}

// What would be filed where, in the order the server wants: one item per placed page, flagged when it replaces a filed side.
export function batchItems(placements: Placements, assignment: string, filedBy: Map<string, Set<string>>) {
  return [...placements.entries()].map(([pageId, p]) => ({
    pageId, student: p.student, assignment, page: p.page, side: p.side, replace: !!filedBy.get(p.student)?.has(key(p)),
  }))
}

// The same side given to two pages of one student: the later one would replace the earlier, so say so before filing.
export function clashes(placements: Placements): Array<{ student: string; side: string }> {
  const seen = new Map<string, number>()
  for (const p of placements.values()) {
    const k = `${p.student}|${key(p)}`
    seen.set(k, (seen.get(k) ?? 0) + 1)
  }
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => { const [student, side] = k.split('|'); return { student, side } })
}
