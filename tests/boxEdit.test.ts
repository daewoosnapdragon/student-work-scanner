import { describe, expect, it } from 'vitest'
import { handleAt, handleCursor, moveBox, nudgeBox, resizeBox, NUDGE } from '../web/src/components/boxEdit.js'

const box = { x: 0.2, y: 0.3, w: 0.4, h: 0.1 }

describe('moving a box', () => {
  it('shifts it by the delta and keeps its size', () => {
    expect(moveBox(box, 0.1, -0.05)).toEqual({ x: 0.3, y: 0.25, w: 0.4, h: 0.1 })
  })
  it('stops at the page edge without shrinking', () => {
    expect(moveBox(box, 0.9, 0)).toEqual({ x: 0.6, y: 0.3, w: 0.4, h: 0.1 })
    expect(moveBox(box, -1, -1)).toEqual({ x: 0, y: 0, w: 0.4, h: 0.1 })
  })
})

describe('resizing a box by a handle', () => {
  it('pulls one side and leaves the others', () => {
    expect(resizeBox(box, 'e', 0.1, 0.5)).toEqual({ x: 0.2, y: 0.3, w: 0.5, h: 0.1 })
    expect(resizeBox(box, 'n', 0.5, -0.1)).toEqual({ x: 0.2, y: 0.2, w: 0.4, h: 0.2 })
    expect(resizeBox(box, 'w', 0.1, 0)).toEqual({ x: 0.3, y: 0.3, w: 0.3, h: 0.1 })
  })
  it('a corner pulls two sides', () => {
    expect(resizeBox(box, 'sw', -0.1, 0.1)).toEqual({ x: 0.1, y: 0.3, w: 0.5, h: 0.2 })
  })
  it('flips rather than inverts when a side crosses its opposite', () => {
    const r = resizeBox(box, 'e', -0.5, 0)
    expect(r.w).toBeGreaterThan(0)
    expect(r.x).toBeCloseTo(0.1)
    expect(r.x + r.w).toBeCloseTo(0.2)
  })
  it('never leaves the page or vanishes', () => {
    const r = resizeBox(box, 'se', 5, 5)
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.y + r.h).toBeLessThanOrEqual(1)
    const tiny = resizeBox(box, 'e', -0.4, 0)
    expect(tiny.w).toBeGreaterThan(0)
  })
})

describe('arrow keys', () => {
  it('move the box a step, or grow it from the bottom-right', () => {
    const r4 = (n: number) => Math.round(n * 10000) / 10000
    expect(nudgeBox(box, 'ArrowRight', false)).toEqual({ ...box, x: r4(0.2 + NUDGE) })
    expect(nudgeBox(box, 'ArrowUp', false)).toEqual({ ...box, y: r4(0.3 - NUDGE) })
    expect(nudgeBox(box, 'ArrowDown', true)).toEqual({ ...box, h: r4(0.1 + NUDGE) })
    expect(nudgeBox(box, 'ArrowLeft', true)).toEqual({ ...box, w: r4(0.4 - NUDGE) })
  })
  it('ignore other keys', () => {
    expect(nudgeBox(box, 'Enter', false)).toBeNull()
  })
})

describe('handles', () => {
  it('sit on the sides and corners', () => {
    expect(handleAt('nw', 100, 50)).toEqual({ x: 0, y: 0 })
    expect(handleAt('e', 100, 50)).toEqual({ x: 100, y: 25 })
    expect(handleAt('s', 100, 50)).toEqual({ x: 50, y: 50 })
  })
  it('have the matching cursor', () => {
    expect(handleCursor('n')).toBe('ns-resize')
    expect(handleCursor('ne')).toBe('nesw-resize')
  })
})
