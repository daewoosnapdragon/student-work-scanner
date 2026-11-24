// Makes a fake scanned pile and two loose pages and drops them in the inbox, so
// the pipeline can be watched end to end without a scanner.
//
// The pile is one PDF of a two-sheet, two-sided assignment for three students,
// fed the way a teacher feeds a real one: every front in pile order, then the
// pile flipped and fed again, so the backs come out in reverse. Twelve pages.
// Three things go wrong in it, the three that go wrong with real piles:
//   - a missed code: the back of the first student's sheet 2 has no code; its
//     front read, so the sheet files itself;
//   - a wrong code: the back of the second student's sheet 1 carries the third
//     student's code (a paste mistake), so the sheet is held to be checked;
//   - a plain sheet: the second student's sheet 2 has no code on either side,
//     next to the held sheet, so it is held too.
// The two loose pages are single images: one carries a code that reads but
// names a sheet the other assignment does not have, the other has no code.
//
// --nocode leaves the codes off every page of the pile: work from before the
// codes, which waits on the Scan screen to be told its assignment.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { PDFDocument } from 'pdf-lib'
import { INBOX_DIR } from '../server/config.js'
import { formatCode } from '../server/codes.js'
import { getAssignment, listAssignments, listStudents, openDb, upsertAssignment } from '../server/db.js'
import type { Side } from '../shared/types.js'

const W = 1240 // A4 at 150 dpi
const H = 1754

/** What a page shows (title, name, sheet and side) and the code on it, if any. */
interface Spec { student: string; name: string; assignment: string; title: string; page: number; side: Side; code: string | null }

// Use whatever roster and assignments are loaded. With nothing loaded yet,
// make the sample assignments for the first three active students.
openDb()
const active = listStudents().filter((s) => s.active)
const students = active.filter((s) => s.grade === active[0]?.grade && s.klass === active[0]?.klass).slice(0, 3)
if (students.length < 3) {
  console.error('Need at least three active students. Run npm run import:students -- your.csv or npm run seed:demo first.')
  process.exit(1)
}
const fits = (x: { klass: string; grade: number | null }) => x.klass === students[0].klass && (x.grade == null || x.grade === students[0].grade)
let a = listAssignments().find((x) => fits(x) && x.sheets === 2 && x.twoSided)
let single = listAssignments().find((x) => fits(x) && x.sheets === 1 && !x.twoSided)
if (!a) {
  upsertAssignment({ code: 'W23', title: 'Short Vowel Sort', klass: students[0].klass, grade: students[0].grade, assignedOn: new Date().toISOString().slice(0, 10), sheets: 2, twoSided: 1, tags: 'phonics, short vowels', notes: 'made by npm run samples' })
  a = getAssignment('W23')!
}
if (!single) {
  upsertAssignment({ code: 'W22', title: 'Weekend Writing', klass: students[0].klass, grade: students[0].grade, assignedOn: new Date().toISOString().slice(0, 10), sheets: 1, twoSided: 0, tags: 'writing, narrative', notes: 'made by npm run samples' })
  single = getAssignment('W22')!
}
const [s1, s2, s3] = students
const first = (s: { name: string }) => s.name.replace(/\s*\(.*\)\s*$/, '')
const nocode = process.argv.includes('--nocode')

/** A page of the pile: who wrote it, and the code printed on it (the owner's own unless told otherwise). */
function sheetSide(s: typeof s1, page: number, side: Side, code: 'own' | 'none' | { student: string } = 'own'): Spec {
  const ref = { student: code === 'own' || code === 'none' ? s.code : code.student, assignment: a!.code, page, side }
  return { student: s.code, name: first(s), assignment: a!.code, title: a!.title, page, side, code: code === 'none' || nocode ? null : formatCode(ref) }
}

// Sheets in pile order, front and back of each: [front, back].
const sheets: Array<[Spec, Spec]> = [
  [sheetSide(s1, 1, 'a'), sheetSide(s1, 1, 'b')],
  [sheetSide(s1, 2, 'a'), sheetSide(s1, 2, 'b', 'none')], // missed code
  [sheetSide(s2, 1, 'a'), sheetSide(s2, 1, 'b', { student: s3.code })], // wrong code
  [sheetSide(s2, 2, 'a', 'none'), sheetSide(s2, 2, 'b', 'none')], // plain sheet
  [sheetSide(s3, 1, 'a'), sheetSide(s3, 1, 'b')],
  [sheetSide(s3, 2, 'a'), sheetSide(s3, 2, 'b')],
]
// Fronts in pile order, then the backs in reverse: page k's back is page 13 − k.
const pile = [...sheets.map(([f]) => f), ...sheets.map(([, b]) => b).reverse()]

const loose: Spec[] = [
  // A code that reads, for a sheet 2 the one-sheet assignment does not have (a child who wrote on, with a label stuck on).
  { student: s3.code, name: first(s3), assignment: single.code, title: single.title, page: 2, side: 'a', code: formatCode({ student: s3.code, assignment: single.code, page: 2, side: 'a' }) },
  // No code at all.
  { student: s1.code, name: first(s1), assignment: single.code, title: single.title, page: 1, side: 'a', code: null },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function render(spec: Spec, i: number): Promise<Buffer> {
  const lines = [
    'the bug sat in the sun and it was hot.',
    'i put my cup on the rug.',
    'a cat and a map and a bag.',
    'the pig can sit.',
  ]
  const writing = lines
    .slice(0, 2 + ((i * 7) % 3))
    .map((t, k) => `<text x="140" y="${560 + k * 110}" font-family="cursive" font-size="54" fill="#2b3a8f" opacity="0.85">${esc(t)}</text>`)
    .join('')
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
    <rect width="100%" height="100%" fill="#fdfcf8"/>
    <text x="120" y="190" font-family="serif" font-size="64" font-weight="bold" fill="#1f1b17">${esc(spec.title)}</text>
    <text x="120" y="260" font-family="sans-serif" font-size="34" fill="#6b6259">${esc(spec.assignment)} · page ${spec.page} ${spec.side === 'a' ? 'front' : 'back'}</text>
    <text x="120" y="380" font-family="sans-serif" font-size="36" fill="#1f1b17">Name: <tspan font-family="cursive" fill="#2b3a8f">${esc(spec.name.split(' ')[0])}</tspan></text>
    <line x1="120" y1="400" x2="800" y2="400" stroke="#cfc5b4" stroke-width="2"/>
    ${writing}
    ${[0, 1, 2, 3, 4].map((k) => `<line x1="120" y1="${1000 + k * 120}" x2="${W - 120}" y2="${1000 + k * 120}" stroke="#e6ddcf" stroke-width="2"/>`).join('')}
  </svg>`
  const composites: sharp.OverlayOptions[] = []
  if (spec.code) {
    const qr = await QRCode.toBuffer(spec.code, { type: 'png', margin: 2, errorCorrectionLevel: 'H', width: 180 })
    composites.push({ input: qr, left: W - 180 - 80, top: 80 })
  }
  return sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 82 }).toBuffer()
}

fs.mkdirSync(INBOX_DIR, { recursive: true })

// The pile: one PDF, one A4 page per scan.
const doc = await PDFDocument.create()
for (let i = 0; i < pile.length; i++) {
  const img = await doc.embedJpg(await render(pile[i], i))
  doc.addPage([595.28, 841.89]).drawImage(img, { x: 0, y: 0, width: 595.28, height: 841.89 })
}
const pdf = path.join(INBOX_DIR, 'scan_0412.pdf')
fs.writeFileSync(pdf, await doc.save())
const t0 = new Date(Date.now() - 12000)
fs.utimesSync(pdf, t0, t0)

// The loose pages, each a later file than the pile so scan order is unambiguous.
for (let i = 0; i < loose.length; i++) {
  const out = path.join(INBOX_DIR, `scan_${String(413 + i).padStart(4, "0")}.jpg`)
  fs.writeFileSync(out, await render(loose[i], pile.length + i))
  const t = new Date(Date.now() - (loose.length - i) * 4000)
  fs.utimesSync(out, t, t)
}

console.log(`Wrote a ${pile.length}-page pile of ${a.code} for ${s1.name}, ${s2.name} and ${s3.name}${nocode ? ' with no codes' : ''}, and ${loose.length} loose pages, to ${INBOX_DIR}`)
