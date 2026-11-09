import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import sharp from 'sharp'
import type { Assignment, Page, Student } from '../shared/types.js'
import { sideLabel } from './codes.js'
import { abs } from './pipeline.js'

// A4 in points. Every scan goes on its own page under a one-line header,
// scaled to fit, so a class PDF reads in the same order as the app.
const W = 595.28
const H = 841.89
const MARGIN = 18
const HEADER = 22

// The PDF's standard fonts only know Latin-1: Korean names are left to the
// scans themselves, which carry them in the handwriting.
const latin = (s: string) => s.replace(/[^ -~ -ÿ]/g, '').replace(/\s+/g, ' ').trim()

export interface PdfSection { student: Student; pages: Page[] }

export async function buildPdf(a: Assignment, sections: PdfSection[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.setTitle(`${a.code} ${a.title}`)
  const font = await doc.embedFont(StandardFonts.Helvetica)
  const bold = await doc.embedFont(StandardFonts.HelveticaBold)
  for (const { student, pages } of sections) {
    for (const p of pages) {
      const jpg = await sharp(abs(p.filePath), { failOn: 'none' }).rotate().resize({ width: 1600, withoutEnlargement: true }).jpeg({ quality: 82 }).toBuffer()
      const img = await doc.embedJpg(jpg)
      const page = doc.addPage([W, H])
      const boxW = W - MARGIN * 2
      const boxH = H - MARGIN * 2 - HEADER
      const scale = Math.min(boxW / img.width, boxH / img.height)
      const w = img.width * scale
      const h = img.height * scale
      page.drawImage(img, { x: (W - w) / 2, y: MARGIN + (boxH - h) / 2, width: w, height: h })
      const name = latin(student.name) || student.code
      const left = `${name}  ${student.code}`
      const right = `${a.code}  ${latin(a.title)}  -  ${sideLabel(p.page ?? 1, p.side ?? 'a')}`
      page.drawText(left, { x: MARGIN, y: H - MARGIN - 10, size: 9, font: bold, color: rgb(0.12, 0.1, 0.09) })
      const rw = font.widthOfTextAtSize(right, 9)
      page.drawText(right, { x: W - MARGIN - rw, y: H - MARGIN - 10, size: 9, font, color: rgb(0.42, 0.38, 0.35) })
      page.drawLine({ start: { x: MARGIN, y: H - MARGIN - 15 }, end: { x: W - MARGIN, y: H - MARGIN - 15 }, thickness: 0.5, color: rgb(0.85, 0.82, 0.76) })
    }
  }
  return doc.save()
}
