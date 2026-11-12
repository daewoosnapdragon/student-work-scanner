import { describe, expect, it } from 'vitest'
import { expectedSides, formatCode, parseCode, sideLabel } from '../server/codes.js'

describe('codes', () => {
  it('round-trips a page reference', () => {
    const ref = { student: 'S07', assignment: 'W23', page: 2, side: 'b' as const }
    expect(formatCode(ref)).toBe('SWS1:S07:W23:2B')
    expect(parseCode(formatCode(ref))).toEqual(ref)
  })
  it('still reads the codes on sets printed before the colon', () => {
    expect(parseCode('SWS1|S07|W23|2b')).toEqual({ student: 'S07', assignment: 'W23', page: 2, side: 'b' })
    expect(parseCode('SWS1:3D07:W24-2:12A')).toEqual({ student: '3D07', assignment: 'W24-2', page: 12, side: 'a' })
  })
  it('is forgiving about case and whitespace', () => {
    expect(parseCode('  sws1|s07|w23|1A ')).toEqual({ student: 'S07', assignment: 'W23', page: 1, side: 'a' })
  })
  it('rejects codes that are not ours', () => {
    expect(parseCode('https://example.com')).toBeNull()
    expect(parseCode('SWS1|S07|W23')).toBeNull()
    expect(parseCode('SWS1:S07:W23')).toBeNull()
    expect(parseCode('SWS2|S07|W23|1a')).toBeNull()
    expect(parseCode('SWS1|S07|W23|0a')).toBeNull()
    expect(parseCode('SWS1|S07|W23|1c')).toBeNull()
    expect(parseCode('')).toBeNull()
    expect(parseCode(null)).toBeNull()
  })
  it('lists expected sides in scan order', () => {
    expect(expectedSides(2, true)).toEqual([
      { page: 1, side: 'a' }, { page: 1, side: 'b' }, { page: 2, side: 'a' }, { page: 2, side: 'b' },
    ])
    expect(expectedSides(1, false)).toEqual([{ page: 1, side: 'a' }])
  })
  it('labels sides for people', () => {
    expect(sideLabel(1, 'a')).toBe('1 front')
    expect(sideLabel(2, 'b')).toBe('2 back')
  })
})
