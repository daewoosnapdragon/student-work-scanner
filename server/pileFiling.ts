// Filing a pile: builds the pure settlePile's input from the database, files
// what it decides, and carries out the teacher's choices on the sheets it
// held. See the design doc, §1 Piles.
//
// This module files through pipeline.ts (fileFromReview); pipeline.ts loads it
// lazily when a pile's last page is in, so there is no import cycle at load.

import { getAssignment, getPage, getPile, getStudent, listStudents, packetPages, packetsForAssignment, pilePages, printedSidesFor, sidesFor, updatePage, updatePile } from './db.js'
import { broadcast } from './events.js'
import { fileFromReview } from './pipeline.js'
import { pairSheets, pileAssignment, settlePile, type PileInput, type SettleResult } from './piles.js'
import type { Assignment, HeldSheet, Page, PageRef, Pile, Side } from '../shared/types.js'

/** Settles a pile from its pages as they stand: files what is certain, holds what is not. */
export function settle(pileId: number): Pile {
  const pile = mustPile(pileId)
  const pages = pilePages(pileId)
  const rows: PileInput['pages'] = pages.map((p) => ({ id: p.id, index: p.pileIndex ?? p.originPage ?? 0, ref: refOf(p) }))
  // The named assignment wins; before it is named, the codes suggest one, and a code naming one never set up waits as unnamed.
  const a = getAssignment(pile.assignment ?? pileAssignment(rows) ?? '') ?? null
  const result = settlePile(a ? { pages: rows, assignment: a, ...contextFor(a) } : { pages: rows, assignment: null, sides: [], printed: [], filed: new Map(), roster: [], turnedIn: new Set() })
  applyDecisions(pile, result)
  const settled = getPile(pileId)!
  broadcast('pile', settled)
  return settled
}

/** What the pure settle needs to know about an assignment beyond the pile itself. */
function contextFor(a: Assignment): Omit<PileInput, 'pages' | 'assignment'> {
  const filed = new Map<string, Set<string>>()
  for (const pk of packetsForAssignment(a.code)) {
    const sides = packetPages(pk.student, a.code).map((p) => `${p.page}${p.side}`)
    if (sides.length) filed.set(pk.student, new Set(sides))
  }
  // the class as the assignment page shows it: active, and the assignment's grade when both say one
  const roster = listStudents(a.klass)
    .filter((s) => s.active && (a.grade == null || s.grade == null || s.grade === a.grade))
    .map((s) => ({ code: s.code, name: s.name }))
  return { sides: sidesFor(a), printed: printedSidesFor(a), filed, roster, turnedIn: new Set(filed.keys()) }
}

/** Files, sets aside and holds the pile's pages as the settle decided, and stores the outcome on the pile. */
export function applyDecisions(pile: Pile, result: SettleResult): void {
  if (result.status === 'new' || !result.assignment || !getAssignment(result.assignment)) {
    // Nothing is decided until the pile has an assignment; its pages wait in it.
    updatePile(pile.id, { status: 'new', assignment: null, sheets: null, twoSided: null, held: [], settledAt: null })
    return
  }
  const inReview = (id: number) => getPage(id)?.status === 'review'
  const held: HeldSheet[] = []
  for (const d of result.decisions) {
    if (d.kind === 'hold') {
      held.push({ sheet: d.sheet, pages: d.pageIds, why: d.why, guesses: d.guesses.map((g) => ({ ...g, studentName: getStudent(g.student)?.name ?? g.student })) })
      for (const id of d.pageIds) if (id != null && inReview(id)) updatePage(id, { reason: 'held' })
      continue
    }
    if (!inReview(d.pageId)) continue // filed or set aside before this settle
    if (d.kind === 'file') {
      try {
        fileFromReview(d.pageId, d.ref, true)
        updatePage(d.pageId, { filedFrom: d.filedFrom })
      } catch (err) {
        // a code that reads but cannot be filed (a student not on the roster): the page goes loose with the reason
        updatePage(d.pageId, { pile: null, reason: (err as Error).message })
      }
    } else if (d.kind === 'not_work') {
      updatePage(d.pageId, { status: 'not_work', pile: null, reason: d.why })
    } else {
      updatePage(d.pageId, { pile: null, reason: d.why })
    }
  }
  // No codes to go by: every sheet waits on the check screen under the packet's suggested student (§1.6).
  if (result.packets) {
    const sheets = pairSheets(pile.pages, !!result.twoSided)
    const byIndex = new Map(pilePages(pile.id).map((p) => [p.pileIndex, p]))
    for (const pk of result.packets) {
      pk.sheets.forEach((n, i) => {
        const [fi, bi] = sheets[n - 1]
        const ids = [byIndex.get(fi)?.id ?? null, bi == null ? null : (byIndex.get(bi)?.id ?? null)].filter((id): id is number => id != null)
        if (!ids.length) return
        const name = pk.student ? (getStudent(pk.student)?.name ?? pk.student) : null
        held.push({
          sheet: n,
          pages: [ids[0], ids[1] ?? null],
          why: 'no codes to go by: sheets are cut into packets in order',
          guesses: pk.student && name ? [{ student: pk.student, studentName: name, page: i + 1, why: `${name} has not turned this in yet` }] : [],
        })
        for (const id of ids) if (inReview(id)) updatePage(id, { reason: 'held' })
      })
    }
  }
  updatePile(pile.id, {
    assignment: result.assignment,
    status: result.status === 'checking' && !held.length ? 'done' : result.status,
    sheets: result.sheets,
    twoSided: result.twoSided == null ? null : result.twoSided ? 1 : 0,
    held,
    settledAt: new Date().toISOString(),
  })
}

/** The teacher names the pile's assignment; the pile is settled afresh under it. */
export function namePile(pileId: number, assignment: string): Pile {
  const pile = mustPile(pileId)
  const code = assignment.trim().toUpperCase()
  if (!getAssignment(code)) throw new Error(`no assignment ${code}`)
  if (pilePages(pileId).some((p) => p.status !== 'review')) throw new Error('this pile has filed pages; undo it before naming it again')
  updatePile(pileId, { assignment: code })
  return settle(pileId)
}

/** Files a held sheet as the given student's sheet: its front as side a, its back as side b. */
export function fileSheet(pileId: number, sheet: number, student: string, page: number): Page[] {
  const out = fileHeld(pileId, sheet, student, page)
  broadcast('pile', getPile(pileId))
  return out
}

/** Sends a held sheet's pages to loose pages. */
export function looseSheet(pileId: number, sheet: number): Page[] {
  const pile = mustPile(pileId)
  const h = heldSheet(pile, sheet)
  const out: Page[] = []
  for (const id of h.pages) {
    if (id == null || getPage(id)?.status !== 'review') continue
    updatePage(id, { pile: null, reason: 'left loose' })
    out.push(getPage(id)!)
  }
  release(pile, sheet)
  broadcast('pile', getPile(pileId))
  return out
}

/** Files each packet's sheets in order as sheets 1..n of its student (the no-codes check, §1.6). */
export function fileAllPackets(pileId: number, packets: Array<{ sheets: number[]; student: string }>): { filed: number; failed: Array<{ sheet: number; error: string }> } {
  mustPile(pileId)
  let filed = 0
  const failed: Array<{ sheet: number; error: string }> = []
  for (const pk of packets) {
    pk.sheets.forEach((sheet, i) => {
      try {
        filed += fileHeld(pileId, sheet, pk.student, i + 1).length
      } catch (err) {
        failed.push({ sheet, error: (err as Error).message })
      }
    })
  }
  broadcast('pile', getPile(pileId))
  return { filed, failed }
}

// ---------- helpers ----------

function fileHeld(pileId: number, sheet: number, student: string, page: number): Page[] {
  const pile = mustPile(pileId)
  const h = heldSheet(pile, sheet)
  const a = pile.assignment ? getAssignment(pile.assignment) : undefined
  if (!a) throw new Error('this pile has no assignment yet')
  student = student.trim().toUpperCase()
  if (!getStudent(student)) throw new Error(`no student ${student}`)
  if (!Number.isInteger(page) || page < 1 || page > a.sheets) throw new Error(`${a.code} has no sheet ${page}`)
  const printed = new Set(printedSidesFor(a).map((s) => `${s.page}${s.side}`))
  const out: Page[] = []
  for (const id of h.pages) {
    if (id == null) continue
    const p = getPage(id)
    if (!p || p.status !== 'review') continue
    // which side a page is comes from where it sits in the pile: past the middle of a two-sided pile, a back
    const side: Side = pile.twoSided && (p.pileIndex ?? 0) > pile.pages / 2 ? 'b' : 'a'
    if (!printed.has(`${page}${side}`)) {
      updatePage(id, { status: 'not_work', pile: null, reason: `sheet ${page} has no printed ${side === 'b' ? 'back' : 'front'}` })
      continue
    }
    out.push(fileFromReview(id, { student, assignment: a.code, page, side }, true))
  }
  release(pile, sheet)
  return out
}

function release(pile: Pile, sheet: number) {
  const held = mustPile(pile.id).held.filter((h) => h.sheet !== sheet)
  updatePile(pile.id, { held, ...(held.length === 0 && pile.status === 'checking' ? { status: 'done' as const } : {}) })
}

function heldSheet(pile: Pile, sheet: number): HeldSheet {
  const h = pile.held.find((x) => x.sheet === sheet)
  if (!h) throw new Error(`sheet ${sheet} is not waiting in this pile`)
  return h
}

function mustPile(id: number): Pile {
  const p = getPile(id)
  if (!p) throw new Error('pile not found')
  return p
}

function refOf(p: Page): PageRef | null {
  return p.student && p.assignment && p.page && p.side ? { student: p.student, assignment: p.assignment, page: p.page, side: p.side } : null
}
