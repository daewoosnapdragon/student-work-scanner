// The pile check's arithmetic, kept apart from the screen so it can be tested.
import type { Student } from '../../../shared/types'
import { readTyped } from './typed'

/** The sheet number to offer for a student: the guess's own when it has one, else the lowest the student still lacks, else 1. */
export function nextSheetNumber(lacking: number[], guessPage: number | null): number {
  if (guessPage != null) return guessPage
  return lacking.length ? Math.min(...lacking) : 1
}

/**
 * A pile scanned without codes, cut into packets over sheet numbers 1..N: packet k takes `sizes[k]`
 * sheets (the usual `perStudent` when not set), in pile order, so changing one packet's size shifts
 * the packets after it. Every packet takes at least one sheet.
 */
export function cutPackets(sheetCount: number, perStudent: number, sizes: number[]): number[][] {
  const out: number[][] = []
  let next = 1, k = 0
  while (next <= sheetCount) {
    const n = Math.max(1, sizes[k] ?? perStudent)
    const packet: number[] = []
    for (let i = 0; i < n && next <= sheetCount; i++) packet.push(next++)
    out.push(packet)
    k++
  }
  return out
}

/** What to look up on the roster for the "Someone else" box: a name, or a bare student code. Empty when there is nothing to search. */
export function typedQuery(text: string): string {
  const t = readTyped(text, [])
  if (t.name) return t.name
  return !t.student && /^[a-z]*\d+$/i.test(text.trim()) ? text.trim() : ''
}

/** A roster search tied to the text it answered, so a late or earlier answer is never read against new text. */
export interface Search { q: string; list: Student[] }
export type Resolved =
  | { kind: 'empty' }
  | { kind: 'searching' }
  | { kind: 'none'; query: string }
  | { kind: 'several'; list: Student[] }
  | { kind: 'one'; student: string; name: string; page: number | null }

/**
 * Who the "Someone else" box names. A full label ("S07 W23 2 back") is read straight; a name or a code
 * waits for the search for exactly that text, and only then resolves. The sheet number comes from a
 * label only when it names this assignment.
 */
export function resolveTyped(text: string, search: Search | null, assignment: string, roster: Student[]): Resolved {
  if (!text.trim()) return { kind: 'empty' }
  const q = typedQuery(text)
  const one = (code: string, list: Student[], page: number | null): Resolved => {
    const who = list.find((s) => s.code === code) ?? roster.find((s) => s.code === code)
    return { kind: 'one', student: code, name: who?.name ?? code, page }
  }
  if (!q) {
    const t = readTyped(text, [])
    if (!t.student) return { kind: 'none', query: text.trim() }
    return one(t.student.toUpperCase(), [], t.assignment?.toUpperCase() === assignment.toUpperCase() ? (t.page ?? null) : null)
  }
  if (!search || search.q !== q) return { kind: 'searching' }
  const exact = search.list.find((m) => m.code.toUpperCase() === q.toUpperCase())
  if (exact) return one(exact.code, search.list, null)
  const t = readTyped(text, search.list)
  if (t.student) return one(t.student.toUpperCase(), search.list, t.assignment?.toUpperCase() === assignment.toUpperCase() ? (t.page ?? null) : null)
  return search.list.length > 1 ? { kind: 'several', list: search.list } : { kind: 'none', query: q }
}

/** A packet's typed sheet count, kept within 1..max; null when nothing readable was typed. */
export function packetSize(text: string, max: number): number | null {
  const n = parseInt(text.trim(), 10)
  if (Number.isNaN(n)) return null
  return Math.min(Math.max(1, max), Math.max(1, n))
}
