import { describe, expect, it } from 'vitest'
import { stackCards, visualRect } from '../web/src/components/margin.js'

const img = { w: 1000, h: 2000 }
const box = { x: 0.1, y: 0.2, w: 0.3, h: 0.05 }

describe('where a box is seen on a turned page', () => {
  it('is the box itself upright', () => {
    expect(visualRect(box, img, 0)).toEqual({ x: 100, y: 400, w: 300, h: 100 })
  })
  it('turned 90° clockwise, the page top becomes the right edge', () => {
    // The box's top-left corner lands at (page height - its bottom, its left).
    expect(visualRect(box, img, 90)).toEqual({ x: 2000 - 500, y: 100, w: 100, h: 300 })
  })
  it('upside down, both axes flip', () => {
    expect(visualRect(box, img, 180)).toEqual({ x: 1000 - 400, y: 2000 - 500, w: 300, h: 100 })
  })
  it('turned 270°, the page top becomes the left edge', () => {
    expect(visualRect(box, img, 270)).toEqual({ x: 400, y: 1000 - 400, w: 100, h: 300 })
    expect(visualRect(box, img, -90)).toEqual(visualRect(box, img, 270))
  })
})

describe('stacking the cards', () => {
  it('leaves cards where they want to be when there is room', () => {
    expect(stackCards([{ want: 10, height: 30 }, { want: 100, height: 30 }], 8)).toEqual([10, 100])
  })
  it('pushes a card down below the one above it', () => {
    expect(stackCards([{ want: 10, height: 30 }, { want: 20, height: 30 }], 8)).toEqual([10, 48])
  })
  it('orders by position, not by the order given, and keeps the answer keyed by input', () => {
    expect(stackCards([{ want: 50, height: 20 }, { want: 0, height: 40 }], 10)).toEqual([50, 0])
    expect(stackCards([{ want: 30, height: 20 }, { want: 0, height: 40 }], 10)).toEqual([50, 0])
  })
  it('copes with nothing', () => {
    expect(stackCards([])).toEqual([])
  })
})
