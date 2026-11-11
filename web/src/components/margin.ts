// The geometry of the comment column beside the page: where a box sits on
// the turned page as it is seen, and how the cards stack down the column
// so that none covers another. Kept apart from React so it can be tested.
import type { Size } from './viewerMath'

export type Rect = { x: number; y: number; w: number; h: number }

/** The column's card width, the gap between page and column, and the gap between cards, in screen pixels. */
export const CARD_W = 220
export const COLUMN_GAP = 18
export const CARD_GAP = 8
/** The room the column needs to the right of the page when the view is fitted. */
export const COLUMN_W = CARD_W + COLUMN_GAP * 2

/**
 * A box, stored as fractions of the upright page, as a rectangle in pixels
 * of the page as it is seen after turning it `rotate` degrees clockwise.
 */
export function visualRect(b: Rect, img: Size, rotate: number): Rect {
  const x = b.x * img.w, y = b.y * img.h, w = b.w * img.w, h = b.h * img.h
  switch (((rotate % 360) + 360) % 360) {
    case 90: return { x: img.h - y - h, y: x, w: h, h: w }
    case 180: return { x: img.w - x - w, y: img.h - y - h, w, h }
    case 270: return { x: y, y: img.w - x - w, w: h, h: w }
    default: return { x, y, w, h }
  }
}

/**
 * Tops for cards that each want to sit level with their box (`want`) but
 * must not overlap: in order down the page, a card that would overlap the
 * one above moves down below it. Heights and the gap are in the same units
 * as the tops. The result is keyed by the item's index in `items`.
 */
export function stackCards(items: Array<{ want: number; height: number }>, gap = CARD_GAP): number[] {
  const order = items.map((it, i) => ({ ...it, i })).sort((a, b) => a.want - b.want || a.i - b.i)
  const tops = new Array<number>(items.length).fill(0)
  let floor = -Infinity
  for (const it of order) {
    const top = Math.max(it.want, floor)
    tops[it.i] = top
    floor = top + it.height + gap
  }
  return tops
}
