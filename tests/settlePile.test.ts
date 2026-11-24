import { describe, expect, it } from 'vitest'
import { pairSheets, pileAssignment, settlePile, type PileInput } from '../server/piles.js'
import type { PageRef } from '../shared/types.js'

const W = { code: 'W14', title: 't', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null, sides: null, expect: null, waiting: 0, analysis: null, rubric: null, createdAt: 'x' }
const sides4 = [{ page: 1, side: 'a' }, { page: 1, side: 'b' }, { page: 2, side: 'a' }, { page: 2, side: 'b' }] as const
const ref = (student: string, page: number, side: 'a' | 'b'): PageRef => ({ student, assignment: 'W14', page, side })
const roster = [{ code: 'S01', name: 'Ara' }, { code: 'S02', name: 'Bo' }, { code: 'S03', name: 'Cho' }]
function input(refs: Array<PageRef | null>, over: Partial<PileInput> = {}): PileInput {
  return { pages: refs.map((r, i) => ({ id: 100 + i, index: i + 1, ref: r })), pageCount: refs.length, assignment: W as any, sides: [...sides4], printed: [...sides4], filed: new Map(), roster, turnedIn: new Set(), ...over }
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
  it('pairs by the PDF page count when pages are missing, reading a sheet from whichever side is there', () => {
    // sheet 2 (pages 2 and 7) gone entirely, and the front of sheet 3 (page 3) gone: pairing still goes by 8
    const pages = input(full).pages.filter((p) => ![2, 7, 3].includes(p.index))
    const r = settlePile(input(full, { pages }))
    expect(r).toMatchObject({ status: 'done', sheets: 4 })
    expect(filed(r).sort()).toEqual(['100:S011a:code', '103:S022a:code', '104:S022b:code', '105:S021b:code', '107:S011b:code'])
  })
  it('does not count a run of held sheets across a missing sheet as jumbled', () => {
    // 6 sheets; sheets 1, 3 and 4 hold a contradiction, sheet 2 (pages 2 and 11) is missing entirely, sheets 5 and 6 read clean
    const refs: Array<PageRef | null> = [
      ref('S01', 1, 'a'), null, ref('S02', 1, 'a'), ref('S03', 1, 'a'), ref('S01', 2, 'a'), ref('S02', 2, 'a'),
      ref('S02', 2, 'b'), ref('S01', 2, 'b'), ref('S02', 1, 'b'), ref('S01', 1, 'b'), null, ref('S03', 2, 'b'),
    ]
    const pages = input(refs).pages.filter((p) => p.index !== 2 && p.index !== 11)
    const r = settlePile(input(refs, { pages }))
    expect(r.status).not.toBe('jumbled')
    expect(held(r).map((d: any) => d.sheet)).toEqual([1, 3, 4])
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
  it('places a codeless sheet between two students when only one of them can take it', () => {
    const r = settlePile(input(full.map((x, i) => (i === 2 || i === 5 ? null : x))))   // S02 sheet 1: between S01 s2 (S01 complete) and S02 s2
    expect(r.status).toBe('done')
    expect(filed(r)).toContain('102:S021a:pile')
    expect(filed(r)).toContain('105:S021b:pile')
  })
  it('holds a codeless sheet between two students when both could take it, with both as guesses', () => {
    // single-sided, 3 sheets: fronts S01 s1, S01 s2, ?, S02 s2, S02 s3 — S01 lacks 3 (fits after), S02 lacks 1 (fits before)
    const W3 = { ...W, sheets: 3, twoSided: 0 }
    const s3 = [{ page: 1, side: 'a' }, { page: 2, side: 'a' }, { page: 3, side: 'a' }] as any
    const r = settlePile(input([ref('S01', 1, 'a'), ref('S01', 2, 'a'), null, ref('S02', 2, 'a'), ref('S02', 3, 'a')], { assignment: W3 as any, sides: s3, printed: s3 }))
    expect(r.status).toBe('checking')
    expect(held(r)).toHaveLength(1)
    expect(held(r)[0]).toMatchObject({ sheet: 3, pageIds: [102, null], why: expect.stringMatching(/between/) })
    expect(held(r)[0].guesses.map((g) => `${g.student}${g.page}`).sort()).toEqual(['S013', 'S021'])
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
    expect(held(r)[0].why).toMatch(/already has every sheet/)
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
    const r = settlePile(input(new Array(8).fill(null), { assignment: null, sides: [], printed: [] }))
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

describe('settling a pile: rules the brief leaves untested', () => {
  // single-sided, 4 sheets, so each page is a sheet
  const W4 = { ...W, sheets: 4, twoSided: 0 }
  const s4 = [1, 2, 3, 4].map((page) => ({ page, side: 'a' })) as any
  const one = (refs: Array<PageRef | null>, over: Partial<PileInput> = {}) => settlePile(input(refs, { assignment: W4 as any, sides: s4, printed: s4, ...over }))

  it('places several codeless sheets in a row inside one student\'s run, in order', () => {
    const r = one([ref('S01', 1, 'a'), null, null, ref('S01', 4, 'a')])
    expect(r.status).toBe('done')
    expect(filed(r)).toEqual(['100:S011a:code', '101:S012a:pile', '102:S013a:pile', '103:S014a:code'])
  })
  it('holds every codeless sheet in a row when the run is missing fewer sheets than there are', () => {
    const r = one([ref('S01', 1, 'a'), null, null, ref('S01', 3, 'a'), ref('S01', 4, 'a')])
    expect(held(r).map((h) => h.sheet)).toEqual([2, 3])
    expect(filed(r).some((f) => f.endsWith(':pile'))).toBe(false)
  })
  it('places several codeless sheets at the end of a run that is missing that many', () => {
    const r = one([ref('S01', 1, 'a'), ref('S01', 2, 'a'), ref('S02', 1, 'a'), ref('S02', 2, 'a'), null, null])
    expect(filed(r)).toContain('104:S023a:pile')
    expect(filed(r)).toContain('105:S024a:pile')
    expect(r.status).toBe('done')
  })
  it('counts sheets already filed for the assignment as had', () => {
    // S02 sheet 1 came in an earlier scan, so the blank between S01's complete run and S02 sheet 2 fits nobody
    const r = one([ref('S01', 1, 'a'), ref('S01', 2, 'a'), ref('S01', 3, 'a'), ref('S01', 4, 'a'), null, ref('S02', 2, 'a')], { filed: new Map([['S02', new Set(['1a'])]]) })
    expect(held(r).map((h) => h.sheet)).toEqual([5])
  })
  it('holds a codeless sheet next to a held sheet rather than guessing past it', () => {
    const r = settlePile(input([ref('S01', 1, 'a'), null, ref('S02', 1, 'a'), ref('S02', 2, 'a'), ref('S02', 2, 'b'), ref('S01', 1, 'b'), null, ref('S01', 1, 'b')]))
    // sheet 3 contradicts (S02 1 / S01 1); sheet 2 has no code and sits beside it
    expect(held(r).map((h) => h.sheet).sort()).toEqual([2, 3])
    expect(held(r).find((h) => h.sheet === 3)!.why).toMatch(/contradict/)
  })
  it('holds two sheets that read as the same student\'s same sheet', () => {
    const r = one([ref('S01', 1, 'a'), ref('S01', 2, 'a'), ref('S01', 2, 'a'), ref('S02', 1, 'a')])
    expect(held(r).map((h) => h.sheet)).toEqual([2, 3])
    expect(filed(r)).not.toContain('101:S012a:code')
  })
  it('files a back fed into a fronts-only pile as that side', () => {
    const r = one([ref('S01', 1, 'a'), ref('S01', 1, 'b'), ref('S01', 2, 'a')])
    expect(filed(r)).toContain('101:S011b:code')
    expect(held(r)).toHaveLength(0)
  })
  it('names the students in a held sheet\'s reasons and guesses', () => {
    const W3 = { ...W, sheets: 3, twoSided: 0 }
    const s3 = [{ page: 1, side: 'a' }, { page: 2, side: 'a' }, { page: 3, side: 'a' }] as any
    const r = settlePile(input([ref('S01', 1, 'a'), ref('S01', 2, 'a'), null, ref('S02', 2, 'a'), ref('S02', 3, 'a')], { assignment: W3 as any, sides: s3, printed: s3 }))
    expect(held(r)[0].why).toBe("no code, between Ara's sheet 2 and Bo's sheet 2, and it could belong to either")
    expect(held(r)[0].guesses.map((g) => g.why).sort()).toEqual(["scanned right after Ara's sheet 2", "scanned right before Bo's sheet 2"])
  })
})

describe('settling a pile: review fixes', () => {
  it('lets the assignment the caller named win over the codes, and sends codes for another assignment loose', () => {
    const w15 = (student: string, page: number, side: 'a' | 'b'): PageRef => ({ ...ref(student, page, side), assignment: 'W15' })
    const r = settlePile(input([w15('S01', 1, 'a'), w15('S01', 2, 'a'), null, null, null, null, w15('S01', 2, 'b'), w15('S01', 1, 'b')]))
    expect(r.assignment).toBe('W14')
    for (const id of [100, 101, 106, 107]) expect(r.decisions.find((d) => d.kind === 'loose' && (d as any).pageId === id)).toBeTruthy()
    expect(r.decisions.some((d) => d.kind === 'file' && d.ref.assignment === 'W15')).toBe(false)
    expect(filed(r)).toEqual([])
  })
  it('lines up guesses for several codeless sheets between two students from each end', () => {
    // single-sided, 2 sheets: Ara 1, ?, ?, Bo 2 — Ara lacks 2 (after her), Bo lacks 1 (before him)
    const W2 = { ...W, twoSided: 0 }
    const s2 = [{ page: 1, side: 'a' }, { page: 2, side: 'a' }] as any
    const r = settlePile(input([ref('S01', 1, 'a'), null, null, ref('S02', 2, 'a')], { assignment: W2 as any, sides: s2, printed: s2 }))
    expect(held(r).map((h) => h.sheet)).toEqual([2, 3])
    const [first, second] = held(r)
    expect(`${first.guesses[0].student}${first.guesses[0].page}`).toBe('S012')
    expect(`${second.guesses[0].student}${second.guesses[0].page}`).toBe('S021')
    expect(second.guesses.at(-1)!.page).toBe(3)            // the extra page past Ara's last sheet comes last
    expect(first.guesses.every((g) => g.page >= 1)).toBe(true)
    expect(first.why).not.toMatch(/could belong to either/)
  })
  it('leaves a sheet set aside as loose out of the no-codes packets', () => {
    const other = { ...ref('S03', 1, 'a'), assignment: 'W15' }
    const r = settlePile(input([other, null, null, null, null, null, null, { ...other, side: 'b' }]))
    expect(r.decisions.filter((d) => d.kind === 'loose').map((d: any) => d.pageId).sort()).toEqual([100, 107])
    expect(r.packets).toEqual([{ sheets: [2, 3], student: 'S01' }, { sheets: [4], student: 'S02' }])
  })
})
