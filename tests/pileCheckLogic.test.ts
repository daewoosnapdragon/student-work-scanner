import { describe, expect, it } from 'vitest'
import { cutPackets, defaultPick, nextSheetNumber, packetSize, resolveTyped, typedQuery } from '../web/src/pages/pileCheckLogic'

describe('nextSheetNumber', () => {
  it('takes the guess’s sheet when it has one', () => expect(nextSheetNumber([1, 3], 2)).toBe(2))
  it('else the lowest sheet the student still lacks', () => expect(nextSheetNumber([3, 2], null)).toBe(2))
  it('else sheet 1', () => expect(nextSheetNumber([], null)).toBe(1))
})

describe('cutPackets', () => {
  it('cuts sheets 1..N into packets of the usual size', () =>
    expect(cutPackets(6, 2, [])).toEqual([[1, 2], [3, 4], [5, 6]]))
  it('leaves a short last packet', () => expect(cutPackets(5, 2, [])).toEqual([[1, 2], [3, 4], [5]]))
  it('a changed size shifts the packets after it, which keep their own sizes', () =>
    expect(cutPackets(7, 2, [2, 3])).toEqual([[1, 2], [3, 4, 5], [6, 7]]))
  it('a size of zero or less still takes one sheet', () => expect(cutPackets(3, 2, [0])).toEqual([[1], [2, 3]]))
  it('a fallback below one still takes one sheet', () => expect(cutPackets(2, 0, [])).toEqual([[1], [2]]))
  it('is empty for no sheets', () => expect(cutPackets(0, 2, [2])).toEqual([]))
})

const lee = { code: 'S03', name: 'Lee Da Yun', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null, active: 1, externalId: null }
const yoon = { ...lee, code: 'S09', name: 'Yoon Seo Eun' }
const leeMin = { ...lee, code: 'S04', name: 'Lee Min Ho' }

describe('typedQuery', () => {
  it('searches a name', () => expect(typedQuery('Lee')).toBe('Lee'))
  it('searches a bare code', () => expect(typedQuery('s03')).toBe('s03'))
  it('does not search a full label or nothing', () => {
    expect(typedQuery('S03 W14 2a')).toBe('')
    expect(typedQuery('  ')).toBe('')
  })
})

describe('resolveTyped', () => {
  it('is empty for nothing typed', () => expect(resolveTyped('', null, 'W14', [])).toEqual({ kind: 'empty' }))
  it('waits while the search for this text has not come back', () =>
    expect(resolveTyped('Lee', null, 'W14', [])).toEqual({ kind: 'searching' }))
  it('never trusts results for an earlier query', () =>
    expect(resolveTyped('Lee', { q: 'Yoon', list: [yoon] }, 'W14', [])).toEqual({ kind: 'searching' }))
  it('takes the one student the current name matches', () =>
    expect(resolveTyped('Lee', { q: 'Lee', list: [lee] }, 'W14', [])).toEqual({ kind: 'one', student: 'S03', name: 'Lee Da Yun', page: null }))
  it('asks which one when several match', () =>
    expect(resolveTyped('Lee', { q: 'Lee', list: [lee, leeMin] }, 'W14', [])).toEqual({ kind: 'several', list: [lee, leeMin] }))
  it('keeps a settled result while more text leaves the query the same', () => {
    expect(typedQuery('Lee ')).toBe('Lee')
    expect(typedQuery('Lee W14 2a')).toBe('Lee')
    expect(resolveTyped('Lee ', { q: 'Lee', list: [lee] }, 'W14', [])).toMatchObject({ kind: 'one', student: 'S03' })
    expect(resolveTyped('Lee W14 2a', { q: 'Lee', list: [lee] }, 'W14', [])).toEqual({ kind: 'one', student: 'S03', name: 'Lee Da Yun', page: 2 })
  })
  it('a different name needs its own search', () => {
    expect(typedQuery('Yoon')).not.toBe('Lee')
    expect(resolveTyped('Yoon', { q: 'Lee', list: [lee] }, 'W14', [])).toEqual({ kind: 'searching' })
  })
  it('says nobody matched', () => expect(resolveTyped('Zed', { q: 'Zed', list: [] }, 'W14', [])).toEqual({ kind: 'none', query: 'Zed' }))
  it('takes an exact code among several matches', () =>
    expect(resolveTyped('s03', { q: 's03', list: [lee, { ...leeMin, code: 'S030' }] }, 'W14', [])).toMatchObject({ kind: 'one', student: 'S03' }))
  it('reads a full label without a search, the sheet only for this assignment', () => {
    expect(resolveTyped('S03 W14 2a', null, 'W14', [lee])).toEqual({ kind: 'one', student: 'S03', name: 'Lee Da Yun', page: 2 })
    expect(resolveTyped('S03 W99 2a', null, 'W14', [])).toEqual({ kind: 'one', student: 'S03', name: 'S03', page: null })
  })
})

describe('packetSize', () => {
  it('reads a number and keeps it within 1..max', () => {
    expect(packetSize('3', 4)).toBe(3)
    expect(packetSize('9', 4)).toBe(4)
    expect(packetSize('0', 4)).toBe(1)
  })
  it('is null for nothing readable', () => {
    expect(packetSize('', 4)).toBeNull()
    expect(packetSize('x', 4)).toBeNull()
  })
})

describe('defaultPick', () => {
  it('picks the first guess that fits', () => expect(defaultPick([{ already: true }, { already: false }])).toBe(2))
  it('picks the first guess when it fits', () => expect(defaultPick([{}, { already: true }])).toBe(1))
  it('picks Someone else when no guess fits', () => expect(defaultPick([{ already: true }, { already: true }])).toBe(3))
  it('picks Someone else when there is no guess', () => expect(defaultPick([])).toBe(1))
})
