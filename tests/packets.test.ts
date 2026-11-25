import { beforeEach, describe, expect, it } from 'vitest'
import { closePacketIncomplete, getAssignment, getPacket, insertPage, nextSeq, openDb, refreshPacket, upsertAssignment, upsertStudent } from '../server/db.js'
import { guessesFor } from '../server/guesses.js'
import type { Page, Side } from '../shared/types.js'

function filed(student: string, assignment: string, page: number, side: Side, at = '2026-11-09T01:00:00.000Z'): Page {
  const seq = nextSeq()
  const p = insertPage({
    status: 'filed', student, assignment, page, side, scannedAt: at, seq, sourceName: `s${seq}.jpg`, filePath: `archive/${assignment}/${student}/${page}${side}.jpg`,
    thumbPath: null, width: 1, height: 1, decoded: `SWS1|${student}|${assignment}|${page}${side}`, reason: null, filedFrom: 'code',
  })
  refreshPacket(student, assignment, at)
  return p
}
function unreadable(at = '2026-11-09T01:00:00.000Z'): Page {
  const seq = nextSeq()
  return insertPage({
    status: 'review', student: null, assignment: null, page: null, side: null, scannedAt: at, seq, sourceName: `s${seq}.jpg`, filePath: `holding/${seq}.jpg`,
    thumbPath: null, width: 1, height: 1, decoded: null, reason: 'Code not readable', filedFrom: null,
  })
}

beforeEach(() => {
  openDb(':memory:')
  upsertStudent({ code: 'S03', name: 'Jiwoo Kim', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  upsertStudent({ code: 'S07', name: 'Minji Park', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  upsertStudent({ code: 'S04', name: 'Seoyeon Lee', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  upsertAssignment({ code: 'W23', title: 'Short Vowel Sort', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null })
  upsertAssignment({ code: 'W22', title: 'Weekend Writing', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 1, twoSided: 0, tags: '', notes: null })
})

describe('packets', () => {
  it('completes when every expected side is filed', () => {
    filed('S03', 'W23', 1, 'a')
    filed('S03', 'W23', 1, 'b')
    filed('S03', 'W23', 2, 'a')
    expect(getPacket('S03', 'W23')).toMatchObject({ sides: 3, expected: 4, complete: 0 })
    filed('S03', 'W23', 2, 'b')
    expect(getPacket('S03', 'W23')).toMatchObject({ sides: 4, expected: 4, complete: 1 })
  })
  it('a single-sided one-sheet assignment completes on the first page', () => {
    filed('S07', 'W22', 1, 'a')
    expect(getPacket('S07', 'W22')).toMatchObject({ sides: 1, expected: 1, complete: 1 })
  })
  it('counts a side once even if it was filed twice', () => {
    filed('S03', 'W23', 1, 'a')
    filed('S03', 'W23', 1, 'a')
    expect(getPacket('S03', 'W23')!.sides).toBe(1)
  })
  it('waits only for the sides that come back, when some stay with the student', () => {
    // two sheets both sides, but the backs are reading pages: only 1 front and 2 front come back
    upsertAssignment({ code: 'W24', title: 'Country Report', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null, expect: '1a,2a' })
    filed('S03', 'W24', 1, 'a')
    expect(getPacket('S03', 'W24')).toMatchObject({ sides: 1, expected: 2, complete: 0 })
    // a reading page scanned anyway is kept with the packet but not counted
    filed('S03', 'W24', 1, 'b')
    expect(getPacket('S03', 'W24')).toMatchObject({ sides: 1, expected: 2, complete: 0 })
    filed('S03', 'W24', 2, 'a')
    expect(getPacket('S03', 'W24')).toMatchObject({ sides: 2, expected: 2, complete: 1 })
  })
  it('an assignment Worksheet Studio registered waits, out of sight, until its first page is scanned', () => {
    upsertAssignment({ code: 'W25', title: 'Leader Traits', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 1, twoSided: 0, tags: '', notes: null, waiting: 1 })
    expect(getAssignment('W25')!.waiting).toBe(1)
    filed('S07', 'W25', 1, 'a')
    expect(getAssignment('W25')!.waiting).toBe(0)
  })
  it('can be closed as incomplete and stays closed on refresh', () => {
    filed('S04', 'W23', 1, 'a')
    closePacketIncomplete('S04', 'W23')
    refreshPacket('S04', 'W23', '2026-11-09T02:00:00.000Z')
    expect(getPacket('S04', 'W23')).toMatchObject({ sides: 1, complete: 1, closedIncomplete: 1 })
  })
})

describe('guesses for an unreadable page', () => {
  it('names the neighbour whose packet is missing exactly one side, and that side', () => {
    filed('S07', 'W23', 1, 'a')
    filed('S07', 'W23', 1, 'b')
    filed('S07', 'W23', 2, 'a')
    const torn = unreadable()
    filed('S03', 'W23', 1, 'a')
    const g = guessesFor(torn)
    expect(g[0]).toMatchObject({ rank: 1, student: 'S07', studentName: 'Minji Park', assignment: 'W23', page: 2, side: 'b' })
    expect(g[0].why).toMatch(/complete the packet/)
    expect(g[1]).toMatchObject({ rank: 2, student: 'S03', assignment: 'W23', page: 1, side: 'b' })
    expect(g[g.length - 1]).toMatchObject({ student: null, why: expect.stringMatching(/Someone else/) })
  })
  it('picks the next side in scan order when several are missing', () => {
    filed('S03', 'W23', 1, 'a')
    const torn = unreadable()
    expect(guessesFor(torn)[0]).toMatchObject({ student: 'S03', page: 1, side: 'b' })
  })
  it('ranks a neighbour with a full packet below one still missing a side', () => {
    filed('S07', 'W22', 1, 'a') // complete already
    const torn = unreadable()
    filed('S04', 'W23', 1, 'a')
    const g = guessesFor(torn)
    expect(g[0].student).toBe('S04')
    expect(g[1]).toMatchObject({ student: 'S07', assignment: 'W22' })
    expect(g[1].why).toMatch(/already has every side/)
  })
  it('always offers "someone else" even with no neighbours', () => {
    const g = guessesFor(unreadable())
    expect(g).toHaveLength(1)
    expect(g[0].student).toBeNull()
  })
  it('puts the decoded code first for a rescan', () => {
    const first = filed('S03', 'W23', 1, 'a')
    const seq = nextSeq()
    const dup = insertPage({
      ...first, id: undefined as unknown as number, status: 'review', seq, scannedAt: '2026-11-09T01:05:00.000Z', reason: 'S03 already has 1a of W23 filed; this may be a rescan',
    } as Omit<Page, 'id'>)
    const g = guessesFor(dup)
    expect(g[0]).toMatchObject({ student: 'S03', assignment: 'W23', page: 1, side: 'a' })
    expect(g[0].why).toMatch(/replaces/)
  })
})
