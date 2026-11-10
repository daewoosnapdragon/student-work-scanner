import { describe, expect, it } from 'vitest'
import { fitView, panBy, rotateView, turned, wheelFactor, zoomAt, MAX_SCALE, MIN_SCALE } from '../web/src/components/viewerMath.js'

const stage = { w: 1000, h: 800 }
const page = { w: 1700, h: 2200 } // a portrait scan

describe('fitting a page to the stage', () => {
  it('fits the taller side with a little air and centres it', () => {
    const v = fitView(stage, page, 0)
    expect(v.s).toBeCloseTo((800 / 2200) * 0.96)
    expect(v.y).toBeCloseTo((800 - 2200 * v.s) / 2)
    expect(v.x).toBeCloseTo((1000 - 1700 * v.s) / 2)
  })
  it('turned 90°, width and height swap and the fit follows', () => {
    expect(turned(page, 90)).toEqual({ w: 2200, h: 1700 })
    expect(turned(page, 180)).toEqual(page)
    const v = fitView(stage, page, 90)
    expect(v.s).toBeCloseTo(Math.min(1000 / 2200, 800 / 1700) * 0.96)
  })
  it('copes with nothing measured yet', () => {
    expect(fitView({ w: 0, h: 0 }, page, 0)).toEqual({ x: 0, y: 0, s: 1 })
  })
})

describe('zooming and panning', () => {
  it('keeps the point under the cursor still', () => {
    const v = fitView(stage, page, 0)
    const cx = 400, cy = 300
    // The page point under the cursor before…
    const px = (cx - v.x) / v.s, py = (cy - v.y) / v.s
    const z = zoomAt(v, 2, cx, cy)
    expect(z.s).toBeCloseTo(v.s * 2)
    // …is still under it after.
    expect(z.x + px * z.s).toBeCloseTo(cx)
    expect(z.y + py * z.s).toBeCloseTo(cy)
  })
  it('stays within the scale limits', () => {
    expect(zoomAt({ x: 0, y: 0, s: 8 }, 10, 0, 0).s).toBe(MAX_SCALE)
    expect(zoomAt({ x: 0, y: 0, s: 0.2 }, 0.01, 0, 0).s).toBe(MIN_SCALE)
  })
  it('pans by the pointer\'s movement', () => {
    expect(panBy({ x: 10, y: 20, s: 1.5 }, 5, -7)).toEqual({ x: 15, y: 13, s: 1.5 })
  })
  it('a wheel tick zooms in for up and out for down, more for a mouse wheel in lines', () => {
    expect(wheelFactor(-100, 0)).toBeGreaterThan(1)
    expect(wheelFactor(100, 0)).toBeLessThan(1)
    expect(wheelFactor(-3, 1)).toBeGreaterThan(1)
    expect(wheelFactor(3, 1)).toBeLessThan(wheelFactor(3, 0))
  })
})

describe('turning a zoomed page', () => {
  it('keeps the page\'s centre where it was', () => {
    const v = { x: 100, y: 50, s: 0.5 }
    const before = { x: v.x + (page.w * v.s) / 2, y: v.y + (page.h * v.s) / 2 }
    const r = rotateView(v, stage, page, 0, 90)
    const t = turned(page, 90)
    expect(r.s).toBe(v.s)
    expect(r.x + (t.w * r.s) / 2).toBeCloseTo(before.x)
    expect(r.y + (t.h * r.s) / 2).toBeCloseTo(before.y)
  })
})
