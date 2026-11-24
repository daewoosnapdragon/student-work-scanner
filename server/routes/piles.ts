// The pile routes, under /api/piles: a pile for the check screen, and the teacher's choices on it.
// See the design doc, §1 Piles and §4 Checking a pile.

import { Router, type Response } from 'express'
import { getAssignment, getPage, getPile, getStudent, listPiles, listStudents, pagesOfPileOrOrigin, pilePages, deleteAssignment } from '../db.js'
import { assignmentFromCodes, pileArriving } from '../pipeline.js'
import { fileAllPackets, fileSheet, looseSheet, namePile, settle, undoPile } from '../pileFiling.js'
import { pairSheets } from '../piles.js'
import type { Assignment, HeldSheet, Page, Pile, Student } from '../../shared/types.js'

export const piles = Router()

/** An assignment's piles still arriving or with sheets to check, newest first. */
export function openPilesFor(code: string, from: Pile[] = listPiles(500)): Pile[] {
  return from.filter((p) => p.assignment === code && (p.status === 'new' || p.status === 'checking'))
}

type SheetStatus = 'filed' | 'held' | 'loose' | 'not_work' | 'missing'
interface SheetRow { sheet: number; front: Page | null; back: Page | null; status: SheetStatus; student: string | null; studentName: string | null }

/**
 * Every sheet of a pile as the PDF's page count pairs them, with the pages at its two places and where
 * they are now. A page that went loose or was set aside has left the pile, so pages are found by the
 * PDF they came from as well as by the pile.
 */
export function pileSheets(pile: Pile): SheetRow[] {
  const rows = pagesOfPileOrOrigin(pile.id, pile.origin)
  const at = new Map<number, Page>()
  for (const p of rows) {
    const i = p.pile === pile.id ? (p.pileIndex ?? p.originPage) : p.originPage
    if (i == null) continue
    // the page that is on file wins a place over one it replaced
    const was = at.get(i)
    if (!was || was.status === 'replaced') at.set(i, p)
  }
  const held = new Set(pile.held.map((h) => h.sheet))
  return pairSheets(pile.pages, !!pile.twoSided).map(([fi, bi], i) => {
    const sheet = i + 1
    const front = at.get(fi) ?? null
    const back = bi == null ? null : (at.get(bi) ?? null)
    const pages = [front, back].filter((p): p is Page => !!p)
    const filed = pages.find((p) => p.status === 'filed' || p.status === 'replaced')
    const status: SheetStatus = held.has(sheet) || pages.some((p) => p.status === 'review' && p.pile === pile.id)
      ? 'held'
      : filed ? 'filed'
      : pages.some((p) => p.status === 'review') ? 'loose'
      : pages.length ? 'not_work'
      : 'missing'
    const student = status === 'filed' ? (filed?.student ?? null) : null
    return { sheet, front, back, status, student, studentName: student ? (getStudent(student)?.name ?? student) : null }
  })
}

/** The class an assignment is for, as its page shows it: active, the assignment's grade when both say one, name order. */
export function rosterFor(a: Assignment): Student[] {
  return listStudents(a.klass).filter((s) => s.active && (a.grade == null || s.grade == null || s.grade === a.grade)).sort((x, y) => x.name.localeCompare(y.name))
}

/** A pile for the check screen: its sheets, the held ones with their pages, and in the no-codes case the packets. */
function pileDetail(pile: Pile) {
  const a = pile.assignment ? (getAssignment(pile.assignment) ?? null) : null
  const sheets = pileSheets(pile)
  const page = (id: number | null) => (id == null ? null : (getPage(id) ?? null))
  const held = pile.held.map((h) => ({ ...h, thumbs: h.pages.map((id) => page(id)?.thumbPath ?? null) as [string | null, string | null] }))
  const live = sheets.filter((x) => x.status !== 'missing').length
  const noCodes = pile.held.length > 0 && pile.held.length === live && pile.held.every((h) => h.guesses.length === 1)
  return {
    pile,
    assignment: a,
    sheets,
    held,
    ...(noCodes ? { packets: packetsOf(pile.held, sheets) } : {}),
    roster: a ? rosterFor(a) : [],
  }
}

/** The no-codes case: consecutive held sheets with the same suggested student make one packet. */
function packetsOf(held: HeldSheet[], sheets: SheetRow[]): Array<{ sheets: number[]; student: string; pages: Page[] }> {
  const out: Array<{ sheets: number[]; student: string; pages: Page[] }> = []
  let prev: number | null = null
  for (const h of [...held].sort((x, y) => x.sheet - y.sheet)) {
    const student = h.guesses[0].student
    const last = out[out.length - 1]
    const row = sheets[h.sheet - 1]
    const pages = [row?.front, row?.back].filter((p): p is Page => !!p)
    // a new packet when the student changes, or the guess starts over at sheet 1
    if (last && last.student === student && prev === h.sheet - 1 && h.guesses[0].page !== 1) {
      last.sheets.push(h.sheet)
      last.pages.push(...pages)
    } else out.push({ sheets: [h.sheet], student, pages })
    prev = h.sheet
  }
  return out
}

function withPile(id: string, res: Response): Pile | null {
  const pile = getPile(Number(id))
  if (!pile) { res.status(404).json({ error: 'no such pile' }); return null }
  return pile
}

piles.get('/:id', (req, res) => {
  const pile = withPile(req.params.id, res)
  if (pile) res.json(pileDetail(pile))
})

// Name the pile's assignment and settle it. With a title as well, an assignment the codes name but
// nobody set up is made first, from what the codes say (the caller's class, grade, sheets and sides win).
piles.post('/:id/assignment', (req, res) => {
  const pile = withPile(req.params.id, res)
  if (!pile) return
  const b = req.body ?? {}
  const code = String(b.code ?? '').trim().toUpperCase()
  if (!code) return res.status(400).json({ error: 'the assignment code is required' })
  let made = false
  try {
    if (!getAssignment(code) && typeof b.title === 'string' && b.title.trim()) {
      const codes = pilePages(pile.id).filter((p) => p.assignment === code)
      if (!codes.length && !b.klass) return res.status(400).json({ error: `no page of this pile reads ${code}; say which class it is for` })
      assignmentFromCodes(code, codes, {
        title: b.title, klass: b.klass ?? null, grade: b.grade == null || b.grade === '' ? null : Number(b.grade),
        sheets: b.sheets == null || b.sheets === '' ? null : Number(b.sheets), twoSided: b.twoSided == null ? null : !!b.twoSided,
      })
      made = true
    }
    res.json(pileDetail(namePile(pile.id, code)))
  } catch (err) {
    // an assignment made for a pile that could not be named goes again: nothing is filed under it
    if (made) deleteAssignment(code)
    res.status(400).json({ error: (err as Error).message })
  }
})

// Settle again with what the pile has (after an undo, the codes decide the assignment).
piles.post('/:id/settle', (req, res) => {
  const pile = withPile(req.params.id, res)
  if (!pile) return
  if (pileArriving(pile.id)) return res.status(400).json({ error: `this pile is still arriving, ${pilePages(pile.id).length} of ${pile.pages} pages in` })
  try {
    res.json(pileDetail(settle(pile.id)))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

piles.post('/:id/undo', (req, res) => {
  const pile = withPile(req.params.id, res)
  if (!pile) return
  try {
    res.json(pileDetail(undoPile(pile.id)))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

piles.post('/:id/sheets/:sheet/file', (req, res) => {
  const pile = withPile(req.params.id, res)
  if (!pile) return
  const b = req.body ?? {}
  if (!b.student || b.page == null) return res.status(400).json({ error: 'student and page are required' })
  try {
    fileSheet(pile.id, Number(req.params.sheet), String(b.student), Number(b.page))
    res.json(pileDetail(getPile(pile.id)!))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

piles.post('/:id/sheets/:sheet/loose', (req, res) => {
  const pile = withPile(req.params.id, res)
  if (!pile) return
  try {
    looseSheet(pile.id, Number(req.params.sheet))
    res.json(pileDetail(getPile(pile.id)!))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// The no-codes check: each packet's sheets filed in order as sheets 1..n of its student.
piles.post('/:id/file-all', (req, res) => {
  const pile = withPile(req.params.id, res)
  if (!pile) return
  const raw = Array.isArray(req.body?.packets) ? (req.body.packets as Array<{ sheets?: unknown; student?: unknown }>) : []
  const packets = raw
    .filter((p) => Array.isArray(p.sheets) && typeof p.student === 'string' && p.student)
    .map((p) => ({ sheets: (p.sheets as unknown[]).map(Number), student: String(p.student) }))
  if (!packets.length) return res.status(400).json({ error: 'nothing to file' })
  try {
    const r = fileAllPackets(pile.id, packets)
    res.json({ ...r, ...pileDetail(getPile(pile.id)!) })
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})
