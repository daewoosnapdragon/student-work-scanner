import { describe, expect, it } from 'vitest'
import { cutPackets, nextSheetNumber } from '../web/src/pages/pileCheckLogic'

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
