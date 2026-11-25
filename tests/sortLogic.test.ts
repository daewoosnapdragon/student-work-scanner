import { describe, expect, it } from 'vitest'
import { applyTyped, batchItems, clashes, cycleSide, place, unplace, type Placements, type SideRef } from '../web/src/pages/sortLogic'

const sides: SideRef[] = [{ page: 1, side: 'a' }, { page: 1, side: 'b' }, { page: 2, side: 'a' }, { page: 2, side: 'b' }]
const none = new Set<string>()

describe('dropping pages on a student', () => {
  it('gives them the open sides in order, skipping what is filed already', () => {
    const p = place(new Map(), [10, 11], 'S07', sides, new Set(['1a']))
    expect(p.get(10)).toEqual({ student: 'S07', page: 1, side: 'b' })
    expect(p.get(11)).toEqual({ student: 'S07', page: 2, side: 'a' })
    const more = place(p, [12, 13], 'S07', sides, new Set(['1a']))
    expect(more.get(12)).toEqual({ student: 'S07', page: 2, side: 'b' })
    expect(more.get(13)).toEqual({ student: 'S07', page: 1, side: 'a' }) // nothing open: goes round again
  })
  it('moves a page from one student to another and frees its old side', () => {
    let p = place(new Map(), [10], 'S07', sides, none)
    p = place(p, [10], 'S03', sides, none)
    expect(p.get(10)).toEqual({ student: 'S03', page: 1, side: 'a' })
    expect(place(p, [11], 'S07', sides, none).get(11)).toEqual({ student: 'S07', page: 1, side: 'a' })
  })
  it('can be taken back to the tray', () => {
    const p = unplace(place(new Map(), [10, 11], 'S07', sides, none), [10])
    expect([...p.keys()]).toEqual([11])
  })
  it('cycles a placed page round the sides', () => {
    let p = place(new Map(), [10], 'S07', sides, none)
    p = cycleSide(p, 10, sides)
    expect(p.get(10)).toMatchObject({ page: 1, side: 'b' })
    p = cycleSide(cycleSide(cycleSide(p, 10, sides), 10, sides), 10, sides)
    expect(p.get(10)).toMatchObject({ page: 1, side: 'a' })
  })
  it('turns into batch items, flagging the ones that replace a filed side, and names clashes', () => {
    const filedBy = new Map([['S07', new Set(['1a'])]])
    let p: Placements = place(new Map(), [10], 'S07', sides, filedBy.get('S07')!)
    p = cycleSide(cycleSide(cycleSide(p, 10, sides), 10, sides), 10, sides) // back round to 1a
    expect(batchItems(p, 'W23', filedBy)).toEqual([{ pageId: 10, student: 'S07', assignment: 'W23', page: 1, side: 'a', replace: true }])
    p = place(p, [11], 'S07', sides, filedBy.get('S07')!)
    p = cycleSide(cycleSide(cycleSide(p, 11, sides), 11, sides), 11, sides)
    expect(clashes(p)).toEqual([{ student: 'S07', side: '1a' }])
  })
})

describe('applying a typed label to the selected pages', () => {
  it('gives the first page the typed side and the rest the next open sides', () => {
    const p = applyTyped(new Map(), [10, 11], { student: 'S07', page: 1, side: 'b' }, sides, none)
    expect(p.get(10)).toEqual({ student: 'S07', page: 1, side: 'b' })
    expect(p.get(11)).toEqual({ student: 'S07', page: 1, side: 'a' })
  })
  it('with a student only, places like a drop', () => {
    const p = applyTyped(new Map(), [10, 11], { student: 'S07' }, sides, new Set(['1a']))
    expect(p.get(10)).toEqual({ student: 'S07', page: 1, side: 'b' })
    expect(p.get(11)).toEqual({ student: 'S07', page: 2, side: 'a' })
  })
  it('falls back to the open sides when the typed side is not on this assignment', () => {
    const p = applyTyped(new Map(), [10], { student: 'S07', page: 9, side: 'a' }, sides, none)
    expect(p.get(10)).toEqual({ student: 'S07', page: 1, side: 'a' })
  })
  it('does nothing with no pages selected', () => {
    const start = new Map()
    expect(applyTyped(start, [], { student: 'S07' }, sides, none)).toBe(start)
  })
})
