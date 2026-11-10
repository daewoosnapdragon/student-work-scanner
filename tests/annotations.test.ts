import { describe, expect, it } from 'vitest'
import { annotationsText, clampBox, describePlace, type Annotation } from '../shared/annotations.js'
import { marksSvg } from '../server/marks.js'
import { toPageFraction, fitView } from '../web/src/components/viewerMath.js'

const mk = (over: Partial<Annotation>): Annotation => ({ id: 1, pageId: 9, x: 0.1, y: 0.1, w: 0.2, h: 0.05, kind: 'note', text: 'hm', createdAt: '2026-11-10T00:00:00.000Z', ...over })

describe('a comment\'s box', () => {
  it('is normalised to a top-left corner and kept on the page', () => {
    expect(clampBox({ x: 0.5, y: 0.5, w: -0.2, h: -0.1 })).toEqual({ x: 0.3, y: 0.4, w: 0.2, h: 0.1 })
    expect(clampBox({ x: 0.9, y: 0.95, w: 0.5, h: 0.5 })).toEqual({ x: 0.9, y: 0.95, w: 0.1, h: 0.05 })
    expect(clampBox({ x: -0.1, y: 0.2, w: 0, h: 0 })).toEqual({ x: 0, y: 0.2, w: 0.005, h: 0.005 })
  })
  it('is described in words by where it sits', () => {
    expect(describePlace({ x: 0.05, y: 0.05, w: 0.1, h: 0.05 })).toBe('near the top left')
    expect(describePlace({ x: 0.8, y: 0.8, w: 0.1, h: 0.05 })).toBe('near the bottom right')
    expect(describePlace({ x: 0.45, y: 0.45, w: 0.1, h: 0.1 })).toBe('in the middle of the page')
    expect(describePlace({ x: 0.7, y: 0.45, w: 0.1, h: 0.1 })).toBe('in the middle, to the right')
    expect(describePlace({ x: 0.45, y: 0.05, w: 0.1, h: 0.1 })).toBe('near the top, in the centre')
    expect(describePlace({ x: 0.1, y: 0.4, w: 0.8, h: 0.1 })).toBe('a band across the middle')
    expect(describePlace({ x: 0.1, y: 0.1, w: 0.8, h: 0.8 })).toBe('most of the page')
  })
})

describe('the marks as text and as a drawing', () => {
  const marks = [mk({ id: 1, kind: 'fix', text: 'she go → she goes', x: 0.1, y: 0.3, w: 0.3, h: 0.04 }), mk({ id: 2, kind: 'praise', text: 'a full sentence', x: 0.1, y: 0.8, w: 0.5, h: 0.04 })]
  it('numbers the marks in the text to match the boxes', () => {
    const t = annotationsText(marks, '1 front')
    expect(t).toMatch(/^The teacher's marks on 1 front, numbered as the boxes drawn on it/)
    expect(t).toContain('1. [fix] near the top left: she go → she goes')
    expect(t).toContain('2. [praise] near the bottom, in the centre: a full sentence')
    expect(annotationsText([], '1 front')).toBe('')
  })
  it('draws one box and one numbered badge per mark, in the kind\'s colour', () => {
    const svg = marksSvg(marks, 1000, 1400)
    expect(svg.match(/<rect/g)).toHaveLength(2)
    expect(svg.match(/<circle/g)).toHaveLength(2)
    expect(svg).toContain('stroke="#8b1e1e"')
    expect(svg).toContain('stroke="#2f7d4f"')
    expect(svg).toContain('<rect x="100" y="420" width="300" height="56"')
    expect(svg).toMatch(/>1<\/text>/)
    expect(svg).toMatch(/>2<\/text>/)
  })
})

describe('a stage point as a fraction of the upright page', () => {
  const stage = { w: 1000, h: 800 }
  const img = { w: 500, h: 700 }
  it('upright, follows the view', () => {
    const v = fitView(stage, img, 0)
    // the page's centre on the stage
    const cx = v.x + (img.w * v.s) / 2, cy = v.y + (img.h * v.s) / 2
    const f = toPageFraction(cx, cy, v, img, 0)
    expect(f.fx).toBeCloseTo(0.5)
    expect(f.fy).toBeCloseTo(0.5)
    const tl = toPageFraction(v.x, v.y, v, img, 0)
    expect(tl.fx).toBeCloseTo(0)
    expect(tl.fy).toBeCloseTo(0)
  })
  it('turned 90° clockwise, the visual top-right is the page\'s top-left', () => {
    const v = fitView(stage, img, 90)
    const vis = { w: img.h, h: img.w }
    const topRight = toPageFraction(v.x + vis.w * v.s, v.y, v, img, 90)
    expect(topRight.fx).toBeCloseTo(0)
    expect(topRight.fy).toBeCloseTo(0)
    const topLeft = toPageFraction(v.x, v.y, v, img, 90)
    expect(topLeft.fx).toBeCloseTo(0)
    expect(topLeft.fy).toBeCloseTo(1)
  })
  it('turned 180°, both axes flip', () => {
    const v = fitView(stage, img, 180)
    const f = toPageFraction(v.x, v.y, v, img, 180)
    expect(f.fx).toBeCloseTo(1)
    expect(f.fy).toBeCloseTo(1)
  })
})
