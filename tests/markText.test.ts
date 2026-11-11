import { describe, expect, it } from 'vitest'
import { clampSize, DEFAULT_MARK_TEXT, fontFamily, MAX_SIZE, MIN_SIZE, parseMarkText } from '../web/src/components/markText.js'

describe('the comment text style', () => {
  it('starts from the default when nothing is stored', () => {
    expect(parseMarkText(null)).toEqual(DEFAULT_MARK_TEXT)
    expect(parseMarkText('')).toEqual(DEFAULT_MARK_TEXT)
    expect(parseMarkText('not json')).toEqual(DEFAULT_MARK_TEXT)
  })
  it('reads what was stored, field by field', () => {
    expect(parseMarkText('{"show":false,"size":18,"font":"hand"}')).toEqual({ show: false, size: 18, font: 'hand' })
    expect(parseMarkText({ size: 20 })).toEqual({ ...DEFAULT_MARK_TEXT, size: 20 })
    expect(parseMarkText({ font: 'wingdings', show: 'yes' })).toEqual(DEFAULT_MARK_TEXT)
  })
  it('keeps the size within reason', () => {
    expect(clampSize(2)).toBe(MIN_SIZE)
    expect(clampSize(900)).toBe(MAX_SIZE)
    expect(clampSize(14.4)).toBe(14)
    expect(clampSize('big')).toBe(DEFAULT_MARK_TEXT.size)
    expect(clampSize(NaN)).toBe(DEFAULT_MARK_TEXT.size)
  })
  it('names a font family for every face', () => {
    for (const f of ['sans', 'serif', 'hand', 'mono'] as const) expect(fontFamily(f)).toMatch(/\w/)
    expect(fontFamily('hand')).toMatch(/cursive/)
  })
})
