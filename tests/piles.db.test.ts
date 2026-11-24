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
    refreshPacket('S07', 'W22', '2026-11-24T02:00:00.000Z')
    expect(getPacket('S07', 'W22')!.feedbackPrintedAt).toBe('2026-11-24T01:00:00.000Z')
  })
})
