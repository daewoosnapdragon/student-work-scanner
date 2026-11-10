// The teacher's comments drawn onto a copy of the page: a thin numbered box
// per comment, in the comment's colour. Claude reads this copy in place of the
// plain scan, and the class PDF carries it too, so what the teacher pointed at
// is pointed at everywhere the page goes.
import sharp from 'sharp'
import { annotationsText, KIND_COLOR, type Annotation } from '../shared/annotations.js'

export interface MarkedImage { buffer: Buffer; width: number; height: number }

/** The page at most `width` wide as a JPEG, with the comments' boxes drawn on when there are any. */
export async function pageJpeg(file: string, marks: Annotation[], width: number, quality = 82): Promise<MarkedImage> {
  const base = sharp(file, { failOn: 'none' }).rotate().resize({ width, withoutEnlargement: true })
  const { data, info } = await base.jpeg({ quality }).toBuffer({ resolveWithObject: true })
  if (!marks.length) return { buffer: data, width: info.width, height: info.height }
  const svg = Buffer.from(marksSvg(marks, info.width, info.height))
  const buffer = await sharp(data).composite([{ input: svg, top: 0, left: 0 }]).jpeg({ quality }).toBuffer()
  return { buffer, width: info.width, height: info.height }
}

/** The overlay as SVG, sized to the picture. Exported for tests. */
export function marksSvg(marks: Annotation[], width: number, height: number): string {
  const stroke = Math.max(2, Math.round(width / 500))
  const r = Math.max(9, Math.round(width / 110)) // the number badge's radius
  const font = Math.round(r * 1.25)
  const shapes = marks.map((m, i) => {
    const x = m.x * width, y = m.y * height, w = m.w * width, h = m.h * height
    const color = KIND_COLOR[m.kind]
    const bx = Math.max(r, Math.min(width - r, x)), by = Math.max(r, Math.min(height - r, y))
    return `<rect x="${f(x)}" y="${f(y)}" width="${f(w)}" height="${f(h)}" rx="${stroke}" fill="${color}" fill-opacity="0.06" stroke="${color}" stroke-width="${stroke}"/>` +
      `<circle cx="${f(bx)}" cy="${f(by)}" r="${r}" fill="${color}"/>` +
      `<text x="${f(bx)}" y="${f(by + font * 0.36)}" text-anchor="middle" font-family="Helvetica, Arial, sans-serif" font-size="${font}" font-weight="700" fill="#fff">${i + 1}</text>`
  })
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">${shapes.join('')}</svg>`
}
const f = (n: number) => Math.round(n * 10) / 10

export { annotationsText }
