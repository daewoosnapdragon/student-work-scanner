# Piles and the Scan Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A scanned PDF files itself as a pile of sheets (fronts in pile order, backs mirrored), the few sheets it cannot settle are checked on one screen, and the app is reorganised into Scan, Assignments and Students with one next action per screen.

**Architecture:** A pure `settlePile` function in `server/piles.ts` decides every sheet of a pile from the decoded codes and the mirror; `server/pipeline.ts` holds a PDF's pages until the last one is decoded, then settles and files through the existing `fileFromReview`. New routes under `/api/scan` and `/api/piles` feed three new screens (Scan, Check a pile, Loose pages); `/api/assignments` gains a stage per row for the hub. Today, Review and Stack are removed; their routes redirect.

**Tech Stack:** Node 22, Express 5, node:sqlite, MuPDF, jsQR, sharp, React 18, react-router 6, vitest, Playwright (verification only). No new runtime dependencies.

**Spec:** `docs/superpowers/specs/2026-11-24-piles-and-the-scan-loop-design.md`

## Global Constraints

- No new runtime dependencies; Node `>=22.13`.
- Archive layout `data/archive/<assignment>/<student>/<page><side>.jpg`, the `pages` and `packets` tables' existing columns, every `/api/analyse`, `/api/skills`, `/api/students`, `/api/assignments` response shape (new fields may be added, none removed) and the Windows scripts are unchanged.
- One red (`btn primary`) button per screen. Every inner page has a breadcrumb to its hub. No raw file paths on screen (folder name, full path in `title`). Keyboard hints only on screens that use keys. Empty states say the next step in one sentence.
- Copy is plain English in the voice of the existing screens: "Check 3", "Settle it", "Undo", "Sort them", "Analyse 16", "Print feedback".
- Commit after every task with the attribution lines the session reminder gives. Run `npm test` and `npm run typecheck` before each commit.

## Review Focus

1. A pile where the teacher forgot to flip (fronts only, two-sided assignment, even count): every mirror "back" carries an `a` code → treated as `jumbled`, coded pages file on their own, nothing filed by position. Test in Task 3.
2. Two piles accidentally in one PDF (two assignments): the pile takes the most common assignment, pages of the other are held, and the mirror fails for three or more consecutive sheets → `jumbled`, not a silent mis-file. Test in Task 3.
3. A student with more sheets than the assignment (wrote a third page on plain paper): the extra unknown sheet sits next to a run that already has every sheet → held, not placed. Test in Task 3.
4. A PDF left half-rendered by a restart: its pages rejoin the pile by name and the pile settles once all `pages` have been decoded. Test in Task 4.
5. Undo after the pile replaced earlier scans of a different assignment (wrong assignment named): the replaced files come back and the packets are whole. Test in Task 5.

---

### Task 1: Schema and types for piles

**Files:**
- Modify: `server/db.ts` (migrate at ~line 24-140, new helpers after `getPacket` ~line 309)
- Modify: `shared/types.ts` (after `Page`, ~line 46)
- Test: `tests/piles.db.test.ts`

**Interfaces:**
- Produces, in `shared/types.ts`:
  ```ts
  export type PileStatus = 'new' | 'checking' | 'done' | 'jumbled'
  export interface HeldGuess { student: string; studentName: string; page: number; why: string }
  export interface HeldSheet { sheet: number; pages: [number, number | null]; why: string; guesses: HeldGuess[] }
  export interface Pile { id: number; origin: string; name: string; assignment: string | null; pages: number; sheets: number | null; twoSided: number | null; status: PileStatus; held: HeldSheet[]; createdAt: string; settledAt: string | null }
  ```
  `Page` gains `pile?: number | null`, `pileIndex?: number | null`; `filedFrom` gains `'pile'`. `Packet` gains `feedbackPrintedAt: string | null`.
- Produces, in `server/db.ts`:
  ```ts
  export function insertPile(p: { origin: string; name: string; pages: number }): Pile
  export function getPile(id: number): Pile | undefined
  export function listPiles(limit?: number): Pile[]            // newest first
  export function updatePile(id: number, patch: Partial<Omit<Pile, 'id' | 'held'>> & { held?: HeldSheet[] }): void
  export function pilePages(pileId: number): Page[]             // ORDER BY pileIndex
  export function markFeedbackPrinted(assignment: string, at: string): void   // every packet of the assignment
  ```
  `held` is stored as JSON text in `piles.held`; `getPile` parses it (`[]` when null).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/piles.db.test.ts
import { beforeEach, describe, expect, it } from 'vitest'
import { getPacket, getPile, insertPage, insertPile, listPiles, markFeedbackPrinted, nextSeq, openDb, pilePages, refreshPacket, updatePile, upsertAssignment, upsertStudent } from '../server/db.js'

beforeEach(() => openDb(':memory:'))

describe('piles table', () => {
  it('inserts, reads back with held parsed, lists newest first', () => {
    const a = insertPile({ origin: 'originals/scan1.pdf', name: 'scan1.pdf', pages: 4 })
    const b = insertPile({ origin: 'originals/scan2.pdf', name: 'scan2.pdf', pages: 2 })
    expect(a).toMatchObject({ status: 'new', assignment: null, sheets: null, held: [], settledAt: null })
    updatePile(a.id, { assignment: 'W23', sheets: 2, twoSided: 1, status: 'checking', held: [{ sheet: 1, pages: [1, 4], why: 'contradiction', guesses: [] }] })
    expect(getPile(a.id)!.held).toEqual([{ sheet: 1, pages: [1, 4], why: 'contradiction', guesses: [] }])
    expect(listPiles().map((p) => p.id)).toEqual([b.id, a.id])
  })
  it('pages know their pile and come back in pile order', () => {
    const p = insertPile({ origin: 'originals/s.pdf', name: 's.pdf', pages: 2 })
    const base = { status: 'review' as const, student: null, assignment: null, page: null, side: null, scannedAt: 'x', sourceName: 's', filePath: 'f', thumbPath: null, width: 1, height: 1, decoded: null, reason: 'in pile', filedFrom: null }
    insertPage({ ...base, seq: nextSeq(), pile: p.id, pileIndex: 2 })
    insertPage({ ...base, seq: nextSeq(), pile: p.id, pileIndex: 1 })
    expect(pilePages(p.id).map((pg) => pg.pileIndex)).toEqual([1, 2])
  })
  it('records when feedback was printed for every packet of an assignment', () => {
    upsertStudent({ code: 'S07', name: 'Minji', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
    upsertAssignment({ code: 'W22', title: 't', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 1, twoSided: 0, tags: '', notes: null })
    refreshPacket('S07', 'W22', '2026-11-24T00:00:00.000Z')
    markFeedbackPrinted('W22', '2026-11-24T01:00:00.000Z')
    expect(getPacket('S07', 'W22')!.feedbackPrintedAt).toBe('2026-11-24T01:00:00.000Z')
  })
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/piles.db.test.ts`
Expected: FAIL, `insertPile is not a function`.

- [ ] **Step 3: Add the schema and helpers**

In `migrate()`: `CREATE TABLE IF NOT EXISTS piles (id INTEGER PRIMARY KEY AUTOINCREMENT, origin TEXT NOT NULL, name TEXT NOT NULL, assignment TEXT, pages INTEGER NOT NULL, sheets INTEGER, twoSided INTEGER, status TEXT NOT NULL DEFAULT 'new', held TEXT, createdAt TEXT NOT NULL, settledAt TEXT)`; `ALTER TABLE pages ADD COLUMN pile INTEGER`, `ADD COLUMN pileIndex INTEGER` guarded like the existing column checks; `ALTER TABLE packets ADD COLUMN feedbackPrintedAt TEXT`; index `pages_pile ON pages(pile, pileIndex)`. Extend `insertPage` with `pile`/`pileIndex` (null default) and `refreshPacket`'s INSERT so `feedbackPrintedAt` survives. Add the helpers with the signatures above.

- [ ] **Step 4: Run tests and typecheck**

Run: `npm test && npm run typecheck`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add server/db.ts shared/types.ts tests/piles.db.test.ts
git commit -m "Piles table, pile columns on pages, feedbackPrintedAt on packets"
```

---

### Task 2: A replaced scan keeps its file, and can be restored

**Files:**
- Modify: `server/pipeline.ts` (`replaceScan` ~line 170, `processImage` ~line 115, `fileFromReview` ~line 195)
- Test: `tests/rescan.test.ts` (extend)

**Interfaces:**
- Produces, in `server/pipeline.ts`:
  ```ts
  export function replacedPath(archivePath: string, oldPageId: number): string   // '…/2b.jpg' → '…/2b.r12.jpg'
  export function restoreReplaced(oldPageId: number): Page   // old record back to 'filed' with its kept file at the archive path; the replacing page's file is moved aside only if it is still there
  ```
- The old page's record keeps `filePath` pointing at its kept file (`archive/W23/S07/2b.r12.jpg`), so the viewer can still open a replaced scan.

- [ ] **Step 1: Write the failing tests** (append to `tests/rescan.test.ts`)

```ts
it('keeps the replaced file beside the new one, and can restore it', async () => {
  const first = await pipeline.processImage(await codedPage('d.jpg', 'SWS1:S07:W22:1A', '#ffffff'), 'd.jpg')
  const again = await pipeline.processImage(await codedPage('e.jpg', 'SWS1:S07:W22:1A', '#dddddd'), 'e.jpg')
  const old = db.getPage(first.id)!
  expect(old.filePath).toBe(pipeline.rel(pipeline.replacedPath(path.join(tmp, again.filePath), first.id)))
  expect(fs.existsSync(path.join(tmp, old.filePath))).toBe(true)
  const restored = pipeline.restoreReplaced(first.id)
  expect(restored).toMatchObject({ id: first.id, status: 'filed', filePath: again.filePath })
  expect(db.getPage(again.id)!.status).toBe('review')
  expect(db.packetPages('S07', 'W22').map((p) => p.id)).toEqual([first.id])
})
```

- [ ] **Step 2: Run to verify it fails**

Run: `npm test -- tests/rescan.test.ts`
Expected: FAIL, `replacedPath is not a function`.

- [ ] **Step 3: Implement**

In `processImage` and `fileFromReview`, before `fs.renameSync(file, dest)` when `dup` exists and `dest` exists on disk: rename `dest` to `replacedPath(dest, dup.id)` and `updatePage(dup.id, { filePath: rel(that) })`. `replaceScan` stays (status `replaced`, comments moved). `restoreReplaced(oldId)`: the old page must be `replaced` and its reason name the replacing page id (`/page (\d+)$/`); move the replacing page's file to holding (`HOLDING_DIR/<seq>-<sourceName>`) and set it to `review` with reason `undone`, move comments back, rename the kept file to the archive path, set the old page `filed` with `filePath` the archive path and `reason: null`, `refreshPacket`.

- [ ] **Step 4: Run tests and typecheck** — `npm test && npm run typecheck`, all pass (the earlier "newer scan is the one on disk" assertion still holds).

- [ ] **Step 5: Commit** — `git commit -m "A replaced scan keeps its file beside the new one and can be restored"`

---

### Task 3: `settlePile`, the pure decision

**Files:**
- Create: `server/piles.ts`
- Test: `tests/settlePile.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export interface PileInput {
    pages: Array<{ id: number; index: number; ref: PageRef | null }>   // index 1-based, in PDF order
    assignment: Assignment | null          // null: not yet named (then only `assignment` of the result is meaningful)
    sides: Array<{ page: number; side: Side }>   // sidesFor(assignment); [] when null
    printed: Array<{ page: number; side: Side }> // printedSidesFor(assignment)
    filed: Map<string, Set<string>>        // student → sides already filed for this assignment ('1a')
    roster: Array<{ code: string; name: string }>  // the assignment's class, name order
    turnedIn: Set<string>                  // students with a packet already
  }
  export type Decision =
    | { kind: 'file'; pageId: number; ref: PageRef; filedFrom: 'code' | 'pile' }
    | { kind: 'not_work'; pageId: number; why: string }
    | { kind: 'hold'; sheet: number; pageIds: [number, number | null]; why: string; guesses: Array<{ student: string; page: number; why: string }> }
    | { kind: 'loose'; pageId: number; why: string }
  export interface SettleResult {
    assignment: string | null            // most common among read codes; null when none read
    status: PileStatus                   // 'done' | 'checking' | 'jumbled' | 'new' (no assignment)
    sheets: number | null; twoSided: boolean | null
    decisions: Decision[]
    packets?: Array<{ sheets: number[]; student: string | null }>   // only in the no-codes case (§1.6)
  }
  export function pileAssignment(pages: PileInput['pages']): string | null
  export function pairSheets(pageCount: number, twoSided: boolean): Array<[number, number | null]>  // [frontIndex, backIndex]
  export function settlePile(input: PileInput): SettleResult
  ```
  `twoSided` for pairing = `input.sides.some((s) => s.side === 'b')`. "Jumbled" = odd page count on a two-sided pile, or three or more consecutive sheets whose read codes disagree with their mirror position. "No codes" = fewer than two sheets known from codes.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/settlePile.test.ts
import { describe, expect, it } from 'vitest'
import { pairSheets, pileAssignment, settlePile, type PileInput } from '../server/piles.js'
import type { PageRef } from '../shared/types.js'

const W = { code: 'W14', title: 't', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null, sides: null, expect: null, waiting: 0, analysis: null, rubric: null, createdAt: 'x' }
const sides4 = [{ page: 1, side: 'a' }, { page: 1, side: 'b' }, { page: 2, side: 'a' }, { page: 2, side: 'b' }] as const
const ref = (student: string, page: number, side: 'a' | 'b'): PageRef => ({ student, assignment: 'W14', page, side })
const roster = [{ code: 'S01', name: 'Ara' }, { code: 'S02', name: 'Bo' }, { code: 'S03', name: 'Cho' }]
function input(refs: Array<PageRef | null>, over: Partial<PileInput> = {}): PileInput {
  return { pages: refs.map((r, i) => ({ id: 100 + i, index: i + 1, ref: r })), assignment: W as any, sides: [...sides4], printed: [...sides4], filed: new Map(), roster, turnedIn: new Set(), ...over }
}
const filed = (r: ReturnType<typeof settlePile>) => r.decisions.filter((d) => d.kind === 'file').map((d: any) => `${d.pageId}:${d.ref.student}${d.ref.page}${d.ref.side}:${d.filedFrom}`)
const held = (r: ReturnType<typeof settlePile>) => r.decisions.filter((d) => d.kind === 'hold')

describe('pairing', () => {
  it('mirrors backs onto fronts', () => {
    expect(pairSheets(8, true)).toEqual([[1, 8], [2, 7], [3, 6], [4, 5]])
    expect(pairSheets(3, false)).toEqual([[1, null], [2, null], [3, null]])
  })
})

describe('settling a pile', () => {
  // 2 students × 2 sheets: fronts 1-4 are S01 s1, S01 s2, S02 s1, S02 s2; backs 5-8 are S02 s2b, S02 s1b, S01 s2b, S01 s1b
  const full = [ref('S01', 1, 'a'), ref('S01', 2, 'a'), ref('S02', 1, 'a'), ref('S02', 2, 'a'), ref('S02', 2, 'b'), ref('S02', 1, 'b'), ref('S01', 2, 'b'), ref('S01', 1, 'b')]

  it('files every page when every code read', () => {
    const r = settlePile(input(full))
    expect(r).toMatchObject({ assignment: 'W14', status: 'done', sheets: 4, twoSided: true })
    expect(filed(r)).toHaveLength(8)
    expect(filed(r)).toContain('100:S011a:code')
    expect(filed(r)).toContain('107:S011b:code')
  })
  it('fills a side whose code missed from its mirror', () => {
    const r = settlePile(input(full.map((x, i) => (i === 7 ? null : x))))
    expect(r.status).toBe('done')
    expect(filed(r)).toContain('107:S011b:pile')
  })
  it('names a sheet with no code on either side from the fronts around it', () => {
    const r = settlePile(input(full.map((x, i) => (i === 1 || i === 6 ? null : x))))   // S01 sheet 2 blank both sides
    expect(r.status).toBe('done')
    expect(filed(r)).toContain('101:S012a:pile')
    expect(filed(r)).toContain('106:S012b:pile')
  })
  it('holds a codeless sheet between two students, with both as guesses', () => {
    const r = settlePile(input(full.map((x, i) => (i === 2 || i === 5 ? null : x))))   // S02 sheet 1: between S01 s2 and S02 s2
    expect(r.status).toBe('checking')
    expect(held(r)).toHaveLength(1)
    expect(held(r)[0]).toMatchObject({ sheet: 3, pageIds: [102, 105], why: expect.stringMatching(/between/) })
    expect(held(r)[0].guesses.map((g) => `${g.student}${g.page}`).sort()).toEqual(['S011', 'S021'].sort())  // S01 lacks nothing → S02 s1 ranks first
    expect(held(r)[0].guesses[0]).toMatchObject({ student: 'S02', page: 1 })
  })
  it('holds a contradiction between a front and its mirror', () => {
    const r = settlePile(input(full.map((x, i) => (i === 7 ? ref('S02', 1, 'b') : x))))
    expect(held(r)).toHaveLength(1)
    expect(held(r)[0]).toMatchObject({ sheet: 1, why: expect.stringMatching(/contradict/) })
    expect(filed(r)).not.toContain('100:S011a:code')
  })
  it('holds a sheet whose code says the wrong side for its position', () => {
    const r = settlePile(input(full.map((x, i) => (i === 7 ? ref('S01', 1, 'a') : x))))   // an a-code where a back should be
    expect(held(r).map((h) => h.sheet)).toEqual([1])
  })
  it('is jumbled when the teacher forgot to flip', () => {
    const r = settlePile(input([ref('S01', 1, 'a'), ref('S01', 2, 'a'), ref('S02', 1, 'a'), ref('S02', 2, 'a'), ref('S03', 1, 'a'), ref('S03', 2, 'a')]))
    expect(r.status).toBe('jumbled')
    expect(filed(r)).toHaveLength(6)                     // clean codes still file on their own
    expect(filed(r).every((f) => f.endsWith(':code'))).toBe(true)
  })
  it('is jumbled on an odd page count for a two-sided assignment, and holds the pages of another assignment', () => {
    const other = { ...ref('S03', 1, 'a'), assignment: 'W15' }
    const r = settlePile(input([...full, other]))
    expect(r).toMatchObject({ assignment: 'W14', status: 'jumbled' })
    expect(r.decisions.find((d) => d.kind === 'loose' && (d as any).pageId === 108)).toBeTruthy()
  })
  it('holds an extra sheet next to a run that already has every sheet', () => {
    // S01 wrote a third page on plain paper: fronts S01 s1, S01 s2, blank, S02 s1, S02 s2 (+ mirrored backs)
    const fronts = [ref('S01', 1, 'a'), ref('S01', 2, 'a'), null, ref('S02', 1, 'a'), ref('S02', 2, 'a')]
    const backs = [ref('S02', 2, 'b'), ref('S02', 1, 'b'), null, ref('S01', 2, 'b'), ref('S01', 1, 'b')]
    const r = settlePile(input([...fronts, ...backs]))
    expect(held(r)).toHaveLength(1)
    expect(held(r)[0].why).toMatch(/already has every sheet|between/)
  })
  it('marks a back the assignment never printed as not work', () => {
    const r = settlePile(input(full.map((x, i) => (i === 4 ? null : x)), { sides: sides4.slice(0, 3) as any, printed: sides4.slice(0, 3) as any }))   // sides = 3: 2b never printed
    expect(r.decisions.find((d) => d.kind === 'not_work')).toMatchObject({ pageId: 104 })
  })
  it('treats an assignment whose backs stay with the student as fronts only', () => {
    const r = settlePile(input([ref('S01', 1, 'a'), ref('S01', 2, 'a'), ref('S02', 1, 'a'), null], { sides: [{ page: 1, side: 'a' }, { page: 2, side: 'a' }], printed: [...sides4] }))
    expect(r.twoSided).toBe(false)
    expect(filed(r)).toContain('103:S022a:pile')
  })
  it('with no codes at all, cuts packets by sheet count and offers the roster in name order', () => {
    const r = settlePile(input(new Array(8).fill(null)))
    expect(r.status).toBe('new')
    expect(r.assignment).toBeNull()
    const named = settlePile(input(new Array(8).fill(null), { turnedIn: new Set(['S01']) }))
    // once the caller supplies the assignment, packets of 2 sheets, students who have not turned in, in name order
    expect(named.packets).toEqual([{ sheets: [1, 2], student: 'S02' }, { sheets: [3, 4], student: 'S03' }])
    expect(named.status).toBe('checking')
  })
})
describe('pileAssignment', () => {
  it('is the most common assignment among read codes', () => {
    expect(pileAssignment([{ id: 1, index: 1, ref: ref('S01', 1, 'a') }, { id: 2, index: 2, ref: { ...ref('S01', 1, 'b'), assignment: 'W15' } }, { id: 3, index: 3, ref: ref('S02', 1, 'a') }])).toBe('W14')
    expect(pileAssignment([{ id: 1, index: 1, ref: null }])).toBeNull()
  })
})
```

Note for the implementer: in `input()`, when `assignment` is given but no code read, `settlePile` returns the no-codes packets (status `checking`) only when `input.assignment` is non-null; the test's first call passes `W` too, so make the first assertion use `input(…, { assignment: null, sides: [], printed: [] })`. Adjust the test accordingly before running.

- [ ] **Step 2: Run to verify it fails** — `npm test -- tests/settlePile.test.ts`, FAIL: module not found.

- [ ] **Step 3: Implement `server/piles.ts`**

Order of work inside `settlePile`: (1) `pileAssignment`; if null and `input.assignment` null → `{ status: 'new', assignment: null, decisions: [] }`. (2) `twoSided`, pairing; odd count on two-sided → jumbled path. (3) Per sheet, classify from the two refs: `known` / `contradiction` / `wrongSide` / `unknown`; refs whose assignment differs from the pile's → `loose` decisions and treated as unread for the sheet. Count consecutive sheets in `contradiction|wrongSide`; three or more → jumbled path. (4) Runs over fronts in order; placement rule from spec §1.4: an unknown sheet takes a neighbouring run's student only when the run on both sides is the same student, or it sits at the start/end of a run, and that student still lacks a sheet number that keeps order (choose the lowest lacking number greater than the known sheet before it and lower than the known sheet after it); sides outside `printed` → `not_work`, outside `sides` but printed → file (kept, not counted, as today). (5) Guesses for held sheets: the neighbouring students, ranked by who still lacks the sheet number that fits, `why` strings `scanned right after her sheet 1` / `scanned right before his sheet 2` style using the assignment's words. (6) No-codes: fewer than two known sheets → `packets` cut by `assignment.sheets`, students = roster minus `turnedIn` in name order, `status: 'checking'`, no file decisions. Jumbled path: every ref that read cleanly (no contradiction with its own mirror if that mirror also read) → `file … filedFrom 'code'`; every other page → `loose`.

- [ ] **Step 4: Run tests and typecheck** — all pass.

- [ ] **Step 5: Commit** — `git commit -m "settlePile: a pile's sheets decided from codes and the mirror"`

---

### Task 4: The pipeline holds a PDF's pages and settles the pile

**Files:**
- Modify: `server/pipeline.ts` (`splitPdf`, `processInboxFile`, `processImage`, new functions)
- Modify: `server/watcher.ts` (no change in behaviour; `drain` already runs a PDF's pages consecutively)
- Test: `tests/pileInbox.test.ts`

**Interfaces:**
- Consumes: `settlePile`, `insertPile/updatePile/pilePages`, `fileFromReview`, `sidesFor/printedSidesFor`.
- Produces, in `server/pipeline.ts`:
  ```ts
  export async function processImage(file: string, sourceName: string, from?: Origin | null, pile?: { id: number; index: number } | null): Promise<Page>
     // with `pile`: decode, thumb, move to holding, insert as status 'review', reason 'in pile', pile/pileIndex set; no filing
  export function settle(pileId: number): Pile          // builds PileInput from the db, calls settlePile, applies decisions, stores held + status
  export function applyDecisions(pile: Pile, result: SettleResult): void
  export function namePile(pileId: number, assignment: string): Pile   // sets assignment, then settle()
  export function fileSheet(pileId: number, sheet: number, student: string, page: number): Page[]   // both pages via fileFromReview(…, true), filedFrom 'review'; removes from held; status 'done' when held empty
  export function looseSheet(pileId: number, sheet: number): Page[]   // pages' pile → null, reason 'left loose'; removes from held
  export function fileAllPackets(pileId: number, packets: Array<{ sheets: number[]; student: string }>): { filed: number; failed: Array<{ sheet: number; error: string }> }
  ```
  `splitPdf` inserts the pile (`insertPile({ origin, name, pages: n })`) and remembers `{ id, index }` per rendered path alongside `Origin`; `processInboxFile` passes it. After `processImage` of a pile page, if `pilePages(id).length === pile.pages` (every page decoded) → `settle(id)`. `settle` on a pile with `assignment` null and no codes leaves status `new`. Decisions: `file` → `fileFromReview(pageId, ref, true)` then `updatePage(pageId, { filedFrom })`; `not_work` → `updatePage(…, { status: 'not_work', pile: null })`; `loose` → `updatePage(…, { pile: null, reason })`; `hold` → kept in `held` with `studentName` looked up. Broadcast `'pile'` events (`broadcast('pile', pile)`) after settle; the `FeedEvent.type` union in `shared/types.ts` gains `'pile'`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/pileInbox.test.ts — same scaffold as tests/pdfInbox.test.ts (SWS_DATA_DIR to a temp dir, dynamic imports, PDF_DPI 60)
// helper: pilePdf(name, codes: Array<string | null>) → a PDF whose page i carries the QR for codes[i] (qrcode → png → embedPng) or nothing
describe('a PDF settles as a pile', () => {
  beforeAll: students S01 'Ara', S02 'Bo', S03 'Cho' in Daisy; assignment W14 sheets 2 twoSided 1
  it('files a clean pile and reports it done', async () => {
    const pdf = await pilePdf('p1.pdf', ['SWS1:S01:W14:1A','SWS1:S01:W14:2A','SWS1:S02:W14:1A','SWS1:S02:W14:2A','SWS1:S02:W14:2B','SWS1:S02:W14:1B','SWS1:S01:W14:2B','SWS1:S01:W14:1B'])
    const rendered = await pipeline.processInboxFile(pdf)
    for (const f of rendered) await pipeline.processInboxFile(f)
    const pile = db.listPiles()[0]
    expect(pile).toMatchObject({ assignment: 'W14', status: 'done', sheets: 4, twoSided: 1, pages: 8 })
    expect(db.getPacket('S01', 'W14')).toMatchObject({ sides: 4, complete: 1 })
    expect(db.reviewPages()).toEqual([])
  })
  it('holds a sheet and files it from the check', async () => {
    // same pile but page 3 (S02 1A) and page 6 (its mirror S02 1B) have no code
    … processInboxFile all …
    const pile = db.listPiles()[0]
    expect(pile.status).toBe('checking'); expect(pile.held).toHaveLength(1)
    expect(pile.held[0].guesses[0]).toMatchObject({ student: 'S02', studentName: 'Bo', page: 1 })
    pipeline.fileSheet(pile.id, pile.held[0].sheet, 'S02', 1)
    expect(db.getPile(pile.id)!.status).toBe('done')
    expect(db.packetPages('S02', 'W14').map((p) => `${p.page}${p.side}:${p.filedFrom}`).sort()).toEqual(['1a:review', '1b:review', '2a:code', '2b:code'])
  })
  it('waits with no codes until named, then offers packets and files them all', async () => {
    … pilePdf('p3.pdf', new Array(4).fill(null)) … processInboxFile all …
    let pile = db.listPiles()[0]
    expect(pile.status).toBe('new'); expect(db.reviewPages().every((p) => p.reason === 'in pile')).toBe(true)
    pile = pipeline.namePile(pile.id, 'W14')
    expect(pile.status).toBe('checking')
    const r = pipeline.fileAllPackets(pile.id, [{ sheets: [1, 2], student: 'S03' }])
    expect(r).toEqual({ filed: 4, failed: [] })
    expect(db.getPacket('S03', 'W14')).toMatchObject({ sides: 4 })
  })
  it('rejoins a pile after a restart from the rendered names', async () => {
    // render p4.pdf, process only the first 3 of 4 pages, then clear the in-memory map (pipeline.forgetRendered()) and process the last
    expect(db.listPiles()[0].status).toBe('done')
  })
})
```
Write the real tests out in full, with the shared helpers at the top of the file; the pseudo-lines above fix the names and assertions.

- [ ] **Step 2: Run to verify it fails** — FAIL: `listPiles()[0]` undefined / `settle is not a function`.

- [ ] **Step 3: Implement** per the Interfaces block. Add `export function forgetRendered()` (clears the in-memory map; test-only) and the by-name fallback: a rendered page whose name matches `stem__pNN` and whose `originals/<stem>.pdf` has a pile row (`getPileByOrigin(origin)` in db) rejoins it with `index = NN`.

- [ ] **Step 4: Run tests and typecheck** — all pass, including `tests/pdfInbox.test.ts` (adjust its first assertion: the two blank pages are now `reason: 'in pile'` until the pile settles, after which, with no codes, the pile is `new` and the pages stay in review with that reason).

- [ ] **Step 5: Commit** — `git commit -m "A PDF is held until its last page is decoded, then settled as a pile"`

---

### Task 5: Undo a pile

**Files:**
- Modify: `server/pipeline.ts` (new `undoPile`), `server/db.ts` (`deletePacket` guard)
- Test: `tests/pileInbox.test.ts` (extend)

**Interfaces:**
- Produces: `export function undoPile(pileId: number): Pile` — for every page with `pile = id` and status `filed` or `not_work`: if it replaced a page (`reason` of some other page is `replaced by rescan, page <id>`), `restoreReplaced(thatOldId)` first; then `unfilePage`-style move to holding, status `review`, reason `in pile`, `student/assignment/page/side` cleared; comments stay with the page. Packets emptied keep their row when `score`, `note`, `feedback`, `analysedAt`, `corrections` or `criteria` is non-null (`sides` → 0, `complete` → 0); deleted otherwise. Pile → `status 'new'`, `assignment null`, `held []`, `sheets null`, `twoSided null`.
- `deletePacket(student, assignment)` is replaced in `unfilePage`/`undoPile` by `emptyOrDeletePacket(student, assignment)` in db.ts with the rule above.

- [ ] **Step 1: Write the failing tests**

```ts
it('undo puts a pile back as it arrived, restores what it replaced, and keeps a scored packet', async () => {
  // S01 has W23 1a filed and scored 3 (setPacketScore); a pile named W23 by mistake replaces it
  … pile of 2 pages both coded SWS1:S01:W23:1A / 1B … settle → done
  pipeline.undoPile(pile.id)
  expect(db.getPile(pile.id)).toMatchObject({ status: 'new', assignment: null, held: [] })
  expect(db.pilePages(pile.id).every((p) => p.status === 'review' && p.reason === 'in pile')).toBe(true)
  expect(db.packetPages('S01', 'W23').map((p) => p.id)).toEqual([originalId])
  expect(db.getPacket('S01', 'W23')).toMatchObject({ score: 3, sides: 1 })
})
it('undo deletes a packet that carries nothing', …)
```

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement.** **Step 4: All tests and typecheck pass.**

- [ ] **Step 5: Commit** — `git commit -m "Undo a pile: pages back, replaced scans restored, scored packets kept"`

---

### Task 6: Scan and pile routes; the assignments hub data; stale packets retired

**Files:**
- Modify: `server/routes/api.ts`
- Modify: `server/pipeline.ts` (remove `stalePackets`, `closeStalePackets`; keep `closePacketIncomplete` use)
- Modify: `server/routes/api.ts` print route `/feedback/:assignment` → `markFeedbackPrinted(a.code, now)` when `only` is null
- Test: `tests/api.scan.test.ts` (supertest is not a dependency: test by calling the handlers through `express` with `app.listen(0)` and `fetch`, the way the server runs)

**Interfaces:**
- Produces:
  - `GET /api/scan` → `{ status: watcherStatus() & { folder: string /* last segment */ }, piles: Array<Pile & { assignmentTitle: string | null; filed: number; toCheck: number; looseFrom: number }>, loose: number }`
  - `GET /api/scan/log` → the old `/api/today` `feed` (last 200 decorated pages), nothing else.
  - `GET /api/piles/:id` → `{ pile, assignment, sheets: Array<{ sheet, front: Page | null, back: Page | null, status: 'filed' | 'held' | 'loose' | 'not_work', student, studentName }>, held: HeldSheet[] (with pages' thumb paths), packets?: SettleResult['packets'] with each packet's sheets' pages, roster }`
  - `POST /api/piles/:id/assignment` `{ code }` or `{ code, title, klass, grade, sheets, twoSided }` (creates it when missing, from the codes as `setupAssignmentFromReview` did) → `namePile`.
  - `POST /api/piles/:id/undo`, `POST /api/piles/:id/sheets/:sheet/file` `{ student, page }`, `POST /api/piles/:id/sheets/:sheet/loose`, `POST /api/piles/:id/file-all` `{ packets }`.
  - `GET /api/review` → loose pages only: `reviewPages().filter((p) => p.pile == null)`; the stale-packet items and `setup-assignment` route are removed; `close-all` and per-packet `close` stay.
  - `GET /api/assignments` rows gain `stage: 'scanning' | 'ready' | 'analysing' | 'analysed' | 'done'`, `toCheck: number`, `missingSide: number`, `analysed: number`, `notIn: string[]` (names, name order), `noticing: { text; at } | null`. Stage rules: `scanning` when any pile with this assignment has status `new`/`checking` or pages with `reason 'in pile'` exist for it; else `analysing` when `queueStatus()` has jobs for it; else `analysed` when every packet has `analysedAt` or `note` and none has `feedbackPrintedAt`; `done` when every packet has `feedbackPrintedAt`; else `ready`. `nextAction` is derived on the client from stage.
  - `POST /api/analyse/assignment/:code` gains `{ closeIncomplete: true }` → `closePacketIncomplete` for every open packet of the assignment before enqueueing.
- Shell badge: `GET /api/scan` is what the nav reads: `piles.filter(checking|new).length + loose`.

- [ ] **Step 1: Write the failing tests** — start the app on port 0 in `beforeAll` (export `makeApp()` from a new `server/app.ts` that `index.ts` uses; `app.listen` stays in `index.ts`); seed a student and assignment; render a held pile through the pipeline; assert `GET /api/scan` lists it with `toCheck: 1`, `GET /api/piles/:id` returns one held sheet with two pages, `POST …/sheets/:sheet/file` empties `held`, `GET /api/assignments` row has `stage: 'ready'` afterwards and `notIn` names, `POST /api/analyse/assignment/W14` with `closeIncomplete` closes an open packet (no key: expect 400 but the packet closed first — or close first and assert, then 400).

- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement.** Remove `/api/today`'s stats and outstanding (the hub carries `notIn`), keep `latestNoticing` per assignment (`metaWithPrefix('noticing:')`). **Step 4: All tests and typecheck pass.**

- [ ] **Step 5: Commit** — `git commit -m "Scan and pile routes, assignment stages, stale packets retired"`

---

### Task 7: Navigation, redirects, the Scan screen and the log

**Files:**
- Modify: `web/src/main.tsx`, `web/src/components/Shell.tsx`
- Create: `web/src/pages/Scan.tsx`, `web/src/pages/ScanLog.tsx`
- Delete: `web/src/pages/Today.tsx`
- Modify: `web/src/api.ts` (export `Pile`, `HeldSheet` types)
- Test: `tests/scanCopy.test.ts` for the pure helpers below

**Interfaces:**
- Produces in `web/src/pages/scanCopy.ts` (pure, tested):
  ```ts
  export function pileLine(p: { pages: number; sheets: number | null; twoSided: number | null; status: PileStatus; filed: number; toCheck: number; looseFrom: number; assignment: string | null }): string
     // 'done' → '24 sheets · all filed'; 'checking' → '24 sheets · 21 filed on their own · 3 to check'; 'new' → '36 pages · no code read'; 'jumbled' → 'The backs did not mirror the fronts, so nothing was filed by position; 4 pages went to loose pages.'
  export function pileAction(p: …): 'check' | 'settle' | 'undo' | null
  export function folderName(path: string): string   // last segment, either slash
  ```
- Routes: `/` and `/scan` → `Scan`; `/scan/pile/:id` → `PileCheck` (Task 8); `/scan/loose` → `Loose` (Task 9); `/scan/log` → `ScanLog`; `/review` → redirect `/scan`; `/review/sort` → `/scan/loose`; `/review/stack` → `/scan`; `/today` → `/scan`. Nav: Scan (badge), Assignments, Students; Compare removed from nav (route stays).
- Scan screen: header line `● watching <folderName> · last page HH:MM` (full path in `title`), lede `Feed one assignment at a time: all the fronts, flip, all the backs.`, pile cards per spec §3 with a `<select>` of assignments and **Settle it** on `new` piles plus a **New assignment from these codes** link that opens the create form prefilled (code from the pile's read codes when any), `Loose pages` card with **Sort them**, footer link `Everything that arrived, page by page →`. Live via `useFetch('/api/scan')`.

- [ ] **Step 1: Write the failing tests** for `pileLine`, `pileAction`, `folderName` with the exact strings above.
- [ ] **Step 2: Run to verify it fails.** **Step 3: Implement** the helpers, Scan, ScanLog (the old Today table minus stats, replaced/skipped rows hidden behind a "Show rescans" toggle), nav and redirects. **Step 4: `npm test && npm run typecheck && npm run build` pass.**
- [ ] **Step 5: Commit** — `git commit -m "Scan screen, page log, nav of Scan / Assignments / Students"`

---

### Task 8: Checking a pile

**Files:**
- Create: `web/src/pages/PileCheck.tsx`, `web/src/pages/pileCheckLogic.ts`
- Test: `tests/pileCheckLogic.test.ts`

**Interfaces:**
- `pileCheckLogic.ts`:
  ```ts
  export function nextSheetNumber(lacking: number[], guessPage: number | null): number   // the guess's page if given, else the lowest lacking, else 1
  export function cutPackets(sheetCount: number, perStudent: number, sizes: number[]): number[][]   // the Stack `chunk` rule over sheet numbers 1..N
  ```
- Screen per spec §4: breadcrumb `Scan / <pile name>`, title `<assignment title> · <code> · N sheets, F filed, H to check`; held sheets one at a time with front and back (`fileUrl(page.filePath)`, click → viewer), "Why" line, guesses 1-3 with "Someone else" taking a name or code (reuse the `readTyped` roster lookup pattern from Review: move `readTyped` into `web/src/pages/typed.ts`), sheet number `<select>` from the assignment's sheets; **File as … Enter**, **Leave it loose X**; J/K/1-3/Enter/X/R; "Checked so far" list. Packets mode when `packets` is present: each packet's sheets as thumbnails (front only), student `<select>` prefilled, sides count input shifting the rest, one **File all**. Done state: `Nothing left to check.` with **Open <code>** and **Back to Scan**.

- [ ] **Step 1: Write the failing tests** for the two helpers. **Step 2: Fail.** **Step 3: Implement.** **Step 4: Tests, typecheck, build pass.**
- [ ] **Step 5: Commit** — `git commit -m "Check a pile: held sheets front and back, guesses, packets mode"`

---

### Task 9: Loose pages

**Files:**
- Rename: `web/src/pages/Sort.tsx` → `web/src/pages/Loose.tsx` (`git mv`), keep `sortLogic.ts`
- Delete: `web/src/pages/Stack.tsx`, `web/src/pages/Review.tsx`
- Modify: `tests/reviewTyped.test.ts` → import `readTyped`/`originLabel` from `web/src/pages/typed.ts`

- Screen: breadcrumb `Scan / Loose pages`, title `Loose pages`, lede `Pages that are not part of any pile: single scans, pages a jumbled pile could not settle, and sheets you left loose. Drag each onto its student.`; the typed-label box from Review sits above the tray and applies to the selected pages (`place` with the parsed student/page/side, or the student alone); the `File a stack instead` link goes. Everything else as Sort is today.

- [ ] **Step 1: Move and rename; update imports and the route; move `readTyped` and `originLabel` to `typed.ts`.** **Step 2: `npm test && npm run typecheck && npm run build` pass.**
- [ ] **Step 3: Commit** — `git commit -m "Loose pages: the sort view, with the typed label; Review and Stack removed"`

---

### Task 10: The Assignments hub

**Files:**
- Modify: `web/src/pages/Assignments.tsx`
- Create: `web/src/pages/stage.ts` (pure)
- Test: `tests/stage.test.ts`

**Interfaces:**
- `stage.ts`:
  ```ts
  export type Stage = 'scanning' | 'ready' | 'analysing' | 'analysed' | 'done'
  export function stageLine(row: { stage: Stage; turnedIn: number; roster: number; toCheck: number; missingSide: number; analysed: number; feedbackPrintedOn: string | null }): string
     // 'Scanning · 16 of 18 in · 3 to check' | 'Ready to analyse · 18 of 18 in' (+ ' · 2 missing a side') | 'Analysing · 4 of 18 done' | 'Analysed · feedback not printed' | 'Done · printed Nov 9'
  export function nextAction(row: { stage: Stage; turnedIn: number; analysisOn: boolean; pileId: number | null }): { label: string; to: string; kind: 'link' | 'analyse' | 'print' }
     // scanning + pileId → { 'Check pile', `/scan/pile/${pileId}` } ; scanning without → { 'Open', `/assignments/${code}` }; ready + analysisOn → { 'Analyse 16', analyse }; ready without key → { 'Copy prompt', `/assignments/${code}?prompt=1` }; analysing → { 'Open' }; analysed → { 'Print feedback', `/print/feedback/${code}`, print }; done → { 'Open' }
  ```
- Screen per spec §6: rows with code, title, class, `stageLine`, one button from `nextAction` (red only on the row whose action is `analyse`/`print`/`check`: at most one red per screen → the first such row is red, the rest plain), "not yet in: …" under the row (five names then "and N more"), **Add an assignment** (existing form), WORTH NOTICING list from `noticing` per row. The Analyse action calls `POST /api/analyse/assignment/:code` and, when `missingSide > 0`, first `window.confirm('<n> packets are missing a side. Analyse them as they are?')` → `{ closeIncomplete: true }`.

- [ ] **Step 1: Tests for `stageLine` and `nextAction` with the exact strings.** **Step 2: Fail.** **Step 3: Implement.** **Step 4: Pass, build.**
- [ ] **Step 5: Commit** — `git commit -m "Assignments hub: a stage and one next action per row"`

---

### Task 11: The assignment page's actions

**Files:**
- Modify: `web/src/pages/Assignment.tsx` (~lines 60-100 actions; `RubricCard`; the "In review" stat)
- Create: `web/src/components/More.tsx` (a button that toggles a card-styled menu of links/buttons, closes on Escape and outside click)

- Per spec §7: one primary button from `nextAction` (reuse `stage.ts`), `More ▾` with Edit, Print labels, Class PDF, Print record, Copy prompt, Paste class answer, Edit rubric, Scoring anchors, Domains, Compare two students, Delete; rubric card collapses to one line with **Edit**; "Switch on analysis" becomes a one-line notice with a Settings link; stat "To check" links to `/scan/pile/:id` when the hub row's `pileId` is set (add `pileId` to `GET /api/assignments/:code`). `?prompt=1` opens the Copy prompt panel.

- [ ] **Step 1: Implement.** **Step 2: `npm run typecheck && npm run build`.** **Step 3: Playwright: open `/assignments/W23`, assert exactly one `button.primary`, the More menu lists eleven items.** 
- [ ] **Step 4: Commit** — `git commit -m "Assignment page: one primary action, the rest under More"`

---

### Task 12: Settings in two sections; Compare out of the menu

**Files:**
- Modify: `web/src/pages/Settings.tsx`, `web/src/pages/Students.tsx` (footer link stays), `web/src/pages/Student.tsx` (unchanged), `web/src/pages/Compare.tsx` (breadcrumb `Students / Compare`)

- Settings: **Claude** card (key, model, auto, about your class, Save) then an **Advanced** `<details>` folded shut holding domains, skill names, the agreement comparison and "What gets sent".

- [ ] **Step 1: Implement.** **Step 2: typecheck, build.** **Step 3: Commit** — `git commit -m "Settings: Claude first, Advanced folded; Compare reached from Students"`

---

### Task 13: README, polish pass, end-to-end run

**Files:**
- Modify: `README.md` ("How a page is filed" rewritten around piles; Review, Stack and Sort paragraphs replaced by Scan / Check / Loose pages; "Trying it without a scanner" updated: `npm run samples` now writes one PDF pile with a missed code, a wrong code and a plain sheet, plus two loose images)
- Modify: `scripts/make-samples.ts` accordingly
- Verify with Playwright (script in the scratchpad, not committed)

- [ ] **Step 1: Update README and samples.**
- [ ] **Step 2: Polish checklist on every screen** (one `button.primary` per screen; breadcrumbs on Scan/pile, Scan/loose, Scan/log, Assignments/code, Students/code, Students/Compare; no `/` or `\` paths in visible text; `kbd.key` hints only on PileCheck and Loose; empty states on Scan, PileCheck, Loose, Assignments).
- [ ] **Step 3: End to end**: `npm run build`, fresh data dir, `seed:demo`, `samples`, start on a spare port; Playwright: Scan shows one pile `checking` with 2 to check and 2 loose; check both (one with Enter on guess 1, one Someone else by name); Scan shows the pile done; Assignments shows W23 `Ready to analyse`; `/review` redirects to `/scan`; screenshots of Scan, PileCheck, Loose, Assignments, Assignment, Settings read as the spec's sketches.
- [ ] **Step 4: `npm test && npm run typecheck && npm run build` all green. Commit** — `git commit -m "README and samples for piles; polish pass"`

---

## Self-review notes

- Spec coverage: §1 → Tasks 3-5; §2-3 → 7; §4 → 8; §5 → 9; §6 → 10; §7 → 11; §8-9 → 12; §10 → 13 and the Global Constraints; Data and API → 1, 6; Migration → 6 (loose = `pile == null`), 7 (redirects), 13 (README).
- Names used across tasks: `settlePile`, `SettleResult`, `Decision`, `HeldSheet`, `Pile`, `settle`, `namePile`, `fileSheet`, `looseSheet`, `fileAllPackets`, `undoPile`, `restoreReplaced`, `replacedPath`, `markFeedbackPrinted`, `stageLine`, `nextAction`, `pileLine`, `pileAction`, `folderName`, `readTyped` (moved to `typed.ts`).
- Review Focus items 1-3 are tests in Task 3, item 4 in Task 4, item 5 in Task 5.
