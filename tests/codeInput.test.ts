import { describe, expect, it } from 'vitest'
import { parseLooseCode, sidesOf } from '../shared/codeInput.js'

describe('typing what the label says', () => {
  it('reads the printed label in any loose form', () => {
    const want = { student: 'S07', assignment: 'W23', page: 2, side: 'b' }
    for (const t of ['S07 W23 2b', 's07 w23 2B', 'S07 · W23 · 2 back', 'S07, W23, 2 back', 'SWS1:S07:W23:2B', 'SWS1|S07|W23|2b', 'S07 W23 2 b', 'S07/W23/2b']) {
      expect(parseLooseCode(t), t).toEqual(want)
    }
  })
  it('takes front or back alone as sheet 1, and a bare sheet number as its front', () => {
    expect(parseLooseCode('S07 W23 front')).toEqual({ student: 'S07', assignment: 'W23', page: 1, side: 'a' })
    expect(parseLooseCode('S07 W23 back')).toEqual({ student: 'S07', assignment: 'W23', page: 1, side: 'b' })
    expect(parseLooseCode('S07 W23 2')).toEqual({ student: 'S07', assignment: 'W23', page: 2, side: 'a' })
    expect(parseLooseCode('4S18 W23')).toEqual({ student: '4S18', assignment: 'W23', page: 1, side: 'a' })
  })
  it('is null for a name, a lone code or nonsense', () => {
    expect(parseLooseCode('Minji')).toBeNull()
    expect(parseLooseCode('S07')).toBeNull()
    expect(parseLooseCode('')).toBeNull()
    expect(parseLooseCode('S07 W23 2c')).toBeNull()
    expect(parseLooseCode('S07 W23 2b extra')).toBeNull()
  })
})

describe('the sides an assignment has', () => {
  const base = { sheets: 2, twoSided: 1, sides: null, expect: null }
  it('lists every side in scan order', () => {
    expect(sidesOf(base).map((s) => `${s.page}${s.side}`)).toEqual(['1a', '1b', '2a', '2b'])
    expect(sidesOf({ ...base, twoSided: 0 }).map((s) => `${s.page}${s.side}`)).toEqual(['1a', '2a'])
  })
  it('stops at "sides in all" and follows the comes-back list', () => {
    expect(sidesOf({ ...base, sides: 3 }).map((s) => `${s.page}${s.side}`)).toEqual(['1a', '1b', '2a'])
    expect(sidesOf({ ...base, expect: '1a,2a' }).map((s) => `${s.page}${s.side}`)).toEqual(['1a', '2a'])
  })
})
