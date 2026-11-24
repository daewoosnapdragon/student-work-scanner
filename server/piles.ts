// Settling a pile: one PDF of a whole assignment, fronts in pile order then the
// backs in reverse, decided sheet by sheet from the codes that read and from
// position. Pure: no file system, no database. The caller passes the
// assignment's sides in and files the decisions. See the design doc, §1 Piles.
//
// The rule throughout: when in doubt, hold. A wrong placement files one
// child's work under another child; a held sheet costs the teacher one click.

import type { Assignment, PageRef, PileStatus, Side } from '../shared/types.js'

export interface PileInput {
  pages: Array<{ id: number; index: number; ref: PageRef | null }> // index 1-based, in PDF order; an index may be missing (a page gone loose or never decoded)
  pageCount: number // the PDF's page count: pairing goes by this, and a missing index is an absent page
  assignment: Assignment | null // null: not yet named (then only `assignment` of the result is meaningful)
  sides: Array<{ page: number; side: Side }> // sidesFor(assignment); [] when null
  printed: Array<{ page: number; side: Side }> // printedSidesFor(assignment)
  filed: Map<string, Set<string>> // student → sides already filed for this assignment ('1a')
  roster: Array<{ code: string; name: string }> // the assignment's class, name order
  turnedIn: Set<string> // students with a packet already
}
export type Decision =
  | { kind: 'file'; pageId: number; ref: PageRef; filedFrom: 'code' | 'pile' }
  | { kind: 'not_work'; pageId: number; why: string }
  // pageIds: the sheet's pages not set aside as loose, front first; [0] is the back only when the front went loose
  | { kind: 'hold'; sheet: number; pageIds: [number, number | null]; why: string; guesses: Array<{ student: string; page: number; why: string }> }
  | { kind: 'loose'; pageId: number; why: string }
export interface SettleResult {
  assignment: string | null // the named assignment when the caller gives one, else the most common among read codes; null when neither
  status: PileStatus // 'done' | 'checking' | 'jumbled' | 'new' (no assignment)
  sheets: number | null
  twoSided: boolean | null
  decisions: Decision[]
  packets?: Array<{ sheets: number[]; student: string | null }> // only when no page read a code for the assignment (§1.6)
}

type PileRow = PileInput['pages'][number]
type Guess = { student: string; page: number; why: string }

/** The most common assignment among the codes that read; ties go to the one read first. */
export function pileAssignment(pages: PileInput['pages']): string | null {
  const counts = new Map<string, number>()
  let best: string | null = null
  for (const p of [...pages].sort((a, b) => a.index - b.index)) {
    if (!p.ref) continue
    const n = (counts.get(p.ref.assignment) ?? 0) + 1
    counts.set(p.ref.assignment, n)
    if (best === null || n > counts.get(best)!) best = p.ref.assignment
  }
  return best
}

/** [frontIndex, backIndex] per sheet: in a two-sided pile of 2N pages, page k's back is page 2N+1−k. */
export function pairSheets(pageCount: number, twoSided: boolean): Array<[number, number | null]> {
  if (!twoSided) return Array.from({ length: pageCount }, (_, i) => [i + 1, null])
  const n = pageCount / 2
  return Array.from({ length: n }, (_, i) => [i + 1, pageCount - i])
}

// ---------- what each sheet says ----------

/** One sheet of the pile after reading its codes (pages of another assignment already set aside). */
type Sheet =
  | { n: number; pages: PileRow[]; kind: 'known'; student: string; page: number }
  | { n: number; pages: PileRow[]; kind: 'held'; why: string; guesses: Guess[] }
  | { n: number; pages: PileRow[]; kind: 'unknown' }

export function settlePile(input: PileInput): SettleResult {
  const code = pileAssignment(input.pages)
  const a = input.assignment
  if (!a) return { assignment: code, status: 'new', sheets: null, twoSided: null, decisions: [] }

  // The assignment the caller named wins; the codes only suggest one before it is named.
  const own = a.code
  const byIndex = new Map(input.pages.map((p) => [p.index, p]))
  const twoSided = input.sides.some((s) => s.side === 'b')
  const name = (student: string) => input.roster.find((r) => r.code === student)?.name ?? student
  const decisions: Decision[] = []

  // Pages whose code names another assignment, or a sheet this one does not have, are set aside and count as unread here.
  const loose = new Set<number>()
  for (const p of input.pages) {
    const why = !p.ref ? null
      : p.ref.assignment !== own ? `its code is for ${p.ref.assignment}, not ${own}`
      : p.ref.page > a.sheets ? `its code says sheet ${p.ref.page}, but ${own} has ${a.sheets}`
      : null
    if (why) {
      loose.add(p.id)
      decisions.push({ kind: 'loose', pageId: p.id, why })
    }
  }
  const refOf = (p: PileRow | undefined) => (p && !loose.has(p.id) ? p.ref : null)

  if (twoSided && input.pageCount % 2 === 1) return jumbled(input, own, decisions, loose)

  const pairs = pairSheets(input.pageCount, twoSided)
  // A sheet with neither page in the input (both gone loose, or never decoded) is skipped; one with a single page is read from that side.
  const sheets: Sheet[] = []
  pairs.forEach(([fi, bi], i) => {
    const front = byIndex.get(fi)
    const back = bi === null ? undefined : byIndex.get(bi)
    if (front || back) sheets.push(readSheet(i + 1, front, back, refOf(front), refOf(back), twoSided, name))
  })

  // Three or more sheets in a row whose codes disagree with their mirror: the pile was not fed as expected.
  // A skipped sheet (no pages at all) breaks the run.
  let row = 0
  let prev = 0
  for (const s of sheets) {
    row = s.kind === 'held' ? (s.n === prev + 1 ? row + 1 : 1) : 0
    prev = s.n
    if (row >= 3) return jumbled(input, own, decisions, loose)
  }

  // A sheet whose only pages were set aside takes no place in the order.
  const live = sheets
    .map((s) => ({ ...s, pages: s.pages.filter((p) => !loose.has(p.id)) }) as Sheet)
    .filter((s) => s.pages.length > 0)

  holdDuplicates(live, twoSided, name)

  if (live.every((s) => s.kind === 'unknown')) {
    // No code for this assignment on any page: packets by sheet count, the next students in name order (§1.6).
    // One code is enough to go by: placeUnknowns places from a single run, and holds what it cannot.
    const waiting = input.roster.filter((r) => !input.turnedIn.has(r.code)).map((r) => r.code)
    const packets: NonNullable<SettleResult['packets']> = []
    // only sheets with a page left in the pile: a sheet set aside as loose is in no packet
    const per = Math.max(1, a.sheets)
    for (let i = 0, k = 0; i < live.length; i += per, k++) {
      packets.push({ sheets: live.slice(i, i + per).map((s) => s.n), student: waiting[k] ?? null })
    }
    return { assignment: own, status: 'checking', sheets: pairs.length, twoSided, decisions, packets }
  }

  placeUnknowns(live, a.sheets, input.filed, twoSided, name)

  const printed = new Set(input.printed.map((s) => `${s.page}${s.side}`))
  for (const s of live) {
    if (s.kind === 'held') {
      decisions.push({ kind: 'hold', sheet: s.n, pageIds: [s.pages[0].id, s.pages[1]?.id ?? null], why: s.why, guesses: s.guesses })
      continue
    }
    if (s.kind === 'unknown') throw new Error(`sheet ${s.n} left unsettled`) // placeUnknowns settles every one
    for (const p of s.pages) {
      const r = refOf(p)
      if (r) {
        decisions.push({ kind: 'file', pageId: p.id, ref: r, filedFrom: 'code' })
        continue
      }
      // The side this page must be, from its position: in a two-sided pile the pages past the middle are backs.
      const side: Side = twoSided && p.index > input.pageCount / 2 ? 'b' : 'a'
      if (!printed.has(`${s.page}${side}`)) {
        decisions.push({ kind: 'not_work', pageId: p.id, why: `sheet ${s.page} has no printed ${side === 'b' ? 'back' : 'front'}` })
      } else {
        decisions.push({ kind: 'file', pageId: p.id, ref: { student: s.student, assignment: own, page: s.page, side }, filedFrom: 'pile' })
      }
    }
  }
  const status: PileStatus = decisions.some((d) => d.kind === 'hold') ? 'checking' : 'done'
  return { assignment: own, status, sheets: pairs.length, twoSided, decisions }
}

function readSheet(
  n: number,
  front: PileRow | undefined,
  back: PileRow | undefined,
  f: PageRef | null,
  b: PageRef | null,
  twoSided: boolean,
  name: (s: string) => string,
): Sheet {
  const pages = [front, back].filter((p): p is PileRow => !!p)
  const says = (r: PageRef) => `${name(r.student)}, sheet ${r.page}`
  const guess = (r: PageRef, where: string): Guess => ({ student: r.student, page: r.page, why: `the code on the ${where} says so` })
  if (twoSided) {
    // A code whose side letter disagrees with where the page sits in the pile.
    const wrong = [f && f.side !== 'a' ? 'front' : null, b && b.side !== 'b' ? 'back' : null].filter(Boolean) as string[]
    if (wrong.length) {
      const where = wrong[0]
      const r = (where === 'front' ? f : b)!
      return {
        n,
        pages,
        kind: 'held',
        why: `the ${where} carries the code of a ${r.side === 'a' ? 'front' : 'back'} (${says(r)}), so this sheet is not where its code says`,
        guesses: dedupe([f && guess(f, 'front'), b && guess(b, 'back')]),
      }
    }
    if (f && b && (f.student !== b.student || f.page !== b.page)) {
      return {
        n,
        pages,
        kind: 'held',
        why: `the codes contradict each other: the front says ${says(f)}, but the back says ${says(b)}`,
        guesses: dedupe([guess(f, 'front'), guess(b, 'back')]),
      }
    }
  }
  const r = f ?? b
  return r ? { n, pages, kind: 'known', student: r.student, page: r.page } : { n, pages, kind: 'unknown' }
}

function dedupe(gs: Array<Guess | null>): Guess[] {
  const out: Guess[] = []
  for (const g of gs) if (g && !out.some((o) => o.student === g.student && o.page === g.page)) out.push(g)
  return out
}

/** Two sheets of one pile reading as the same student's same sheet: one code is a paste mistake, and nothing says which. */
function holdDuplicates(sheets: Sheet[], twoSided: boolean, name: (s: string) => string): void {
  const key = (s: Sheet & { kind: 'known' }) => {
    // single-sided: a back fed by mistake is its own side, not a second copy of the front
    const side = twoSided ? '' : (s.pages[0].ref?.side ?? 'a')
    return `${s.student}:${s.page}${side}`
  }
  const seen = new Map<string, number>()
  for (const s of sheets) if (s.kind === 'known') seen.set(key(s), (seen.get(key(s)) ?? 0) + 1)
  for (let i = 0; i < sheets.length; i++) {
    const s = sheets[i]
    if (s.kind !== 'known' || seen.get(key(s))! < 2) continue
    sheets[i] = {
      n: s.n,
      pages: s.pages,
      kind: 'held',
      why: `more than one sheet in this pile reads as ${name(s.student)}'s sheet ${s.page}`,
      guesses: [{ student: s.student, page: s.page, why: 'its code says so' }],
    }
  }
}

// ---------- owners by position (§1.4) ----------

/**
 * Settles every unknown sheet in place, turning it into a known (placed) or a held sheet.
 * Unknowns are taken in groups of consecutive codeless sheets, each group looked at
 * together with the sheet just before it and the sheet just after it.
 */
function placeUnknowns(sheets: Sheet[], sheetCount: number, filed: Map<string, Set<string>>, twoSided: boolean, name: (s: string) => string): void {
  // What each student already has: sheets known in this pile, and sheets with any side filed before.
  const has = new Map<string, Set<number>>()
  const give = (student: string, page: number) => {
    if (!has.has(student)) has.set(student, new Set())
    has.get(student)!.add(page)
  }
  for (const [student, sides] of filed) for (const side of sides) give(student, parseInt(side, 10))
  for (const s of sheets) if (s.kind === 'known') give(s.student, s.page)
  /** The sheet numbers a student still lacks within (above, below), exclusive, lowest first. */
  const lacks = (student: string, above: number, below: number) => {
    const out: number[] = []
    for (let p = above + 1; p < below && p <= sheetCount; p++) if (!has.get(student)?.has(p)) out.push(p)
    return out
  }
  const blank = twoSided ? 'no code on either side' : 'no code'
  const at = (s: Sheet & { kind: 'known' }) => `${name(s.student)}'s sheet ${s.page}`

  let i = 0
  while (i < sheets.length) {
    if (sheets[i].kind !== 'unknown') {
      i++
      continue
    }
    let end = i
    while (end < sheets.length && sheets[end].kind === 'unknown') end++
    const group = sheets.slice(i, end)
    const k = group.length
    const before = sheets[i - 1] as Sheet | undefined
    const after = sheets[end] as Sheet | undefined
    const prev = before?.kind === 'known' ? before : undefined
    const next = after?.kind === 'known' ? after : undefined

    // What the student before could take (numbers after theirs), and the student after (numbers before theirs).
    const fromPrev = prev ? lacks(prev.student, prev.page, next && next.student === prev.student ? next.page : Infinity) : []
    const fromNext = next && !(prev && prev.student === next.student) ? lacks(next.student, 0, next.page) : []

    const place = (student: string, numbers: number[]) => {
      group.forEach((s, j) => {
        sheets[i + j] = { n: s.n, pages: s.pages, kind: 'known', student, page: numbers[j] }
        give(student, numbers[j])
      })
    }
    // The guesses for the j-th codeless sheet of the group: the neighbours, the one that can still take it first.
    // The student after takes the numbers nearest them, so the sheet right before `next` lines up with the last of fromNext.
    const guesses = (j: number): Guess[] => {
      const out: Array<Guess & { fits: boolean }> = []
      if (prev) {
        const page = fromPrev[j] ?? prev.page + 1 + j
        out.push({ student: prev.student, page, fits: fromPrev[j] !== undefined, why: j === 0 ? `scanned right after ${at(prev)}` : `scanned ${j + 1} sheets after ${at(prev)}` })
      }
      if (next && !(prev && prev.student === next.student)) {
        const back = k - 1 - j
        const fit = fromNext[fromNext.length - 1 - back] as number | undefined
        const page = fit ?? next.page - 1 - back
        if (page >= 1)
          out.push({ student: next.student, page, fits: fit !== undefined, why: back === 0 ? `scanned right before ${at(next)}` : `scanned ${back + 1} sheets before ${at(next)}` })
      }
      // a student who lacks the number first, then one who has it (filing it replaces theirs); never a sheet the assignment does not have
      return out.filter((g) => g.page <= sheetCount).sort((x, y) => Number(y.fits) - Number(x.fits)).map(({ fits: _, ...g }) => g)
    }
    const hold = (why: string) => {
      group.forEach((s, j) => {
        sheets[i + j] = { n: s.n, pages: s.pages, kind: 'held', why, guesses: guesses(j) }
      })
    }
    const several = k > 1 ? `, one of ${k} such sheets in a row` : ''

    if ((before && !prev) || (after && !next)) {
      // A neighbour is itself held: whose sheet that is is not known, so neither is this one's.
      hold(`${blank}, next to a sheet that is held`)
    } else if (!prev && !next) {
      hold(`${blank} and no neighbour with a code`)
    } else if (prev && next && prev.student === next.student) {
      if (fromPrev.length >= k) place(prev.student, fromPrev)
      else hold(`${blank}${several}, between ${at(prev)} and ${at(next)}, and ${name(prev.student)} is not missing a sheet that fits here`)
    } else if (prev && next) {
      if (fromPrev.length >= k && fromNext.length === 0) place(prev.student, fromPrev)
      else if (fromNext.length >= k && fromPrev.length === 0) place(next.student, fromNext)
      else if (fromPrev.length === 0 && fromNext.length === 0)
        hold(`${blank}${several}, between ${at(prev)} and ${at(next)}, and neither is missing a sheet that fits here (${name(prev.student)} already has every sheet after it)`)
      else if (k === 1) hold(`${blank}, between ${at(prev)} and ${at(next)}, and it could belong to either`)
      else hold(`${blank}${several}, between ${at(prev)} and ${at(next)}, and which of them belong to whom is not certain`)
    } else {
      // At the start or end of the pile, beside one run only.
      const s = (prev ?? next)!
      const can = prev ? fromPrev : fromNext
      if (can.length >= k) place(s.student, can)
      else if (can.length === 0) hold(`${blank}${several}, next to ${at(s)}, and ${name(s.student)} already has every sheet that would fit here`)
      else hold(`${blank}${several}, next to ${at(s)}, and ${name(s.student)} is missing fewer sheets than that`)
    }
    i = end
  }
}

// ---------- jumbled (§1.2) ----------

/**
 * Position means nothing in a jumbled pile: every page whose code reads cleanly files on its own,
 * as a single scanned page would, and every other page goes loose. "Cleanly" cannot mean agreeing
 * with its mirror here (a pile fed unflipped disagrees with every mirror), so a code is refused
 * only when another page of the pile reads exactly the same.
 */
function jumbled(input: PileInput, own: string, decisions: Decision[], loose: Set<number>): SettleResult {
  const key = (r: PageRef) => `${r.student}:${r.page}${r.side}`
  const count = new Map<string, number>()
  for (const p of input.pages) if (p.ref && !loose.has(p.id)) count.set(key(p.ref), (count.get(key(p.ref)) ?? 0) + 1)
  for (const p of [...input.pages].sort((x, y) => x.index - y.index)) {
    if (loose.has(p.id)) continue
    if (!p.ref) decisions.push({ kind: 'loose', pageId: p.id, why: 'the pile is jumbled and this page has no code that read' })
    else if (count.get(key(p.ref))! > 1) decisions.push({ kind: 'loose', pageId: p.id, why: 'another page in this pile reads with the same code' })
    else decisions.push({ kind: 'file', pageId: p.id, ref: p.ref, filedFrom: 'code' })
  }
  return { assignment: own, status: 'jumbled', sheets: null, twoSided: input.sides.some((s) => s.side === 'b'), decisions }
}
