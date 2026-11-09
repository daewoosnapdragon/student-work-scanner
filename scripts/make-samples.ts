// Makes fake scanned pages and drops them in the inbox, so the pipeline can be
// watched end to end without a scanner. Each page is an A4 sheet at 150 dpi
// with the title, a name line, some pencil-coloured writing, and the QR code in
// the top right corner. One page has its code torn off so it lands in review,
// and one is a rescan of a side already filed.
import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import QRCode from 'qrcode'
import { INBOX_DIR } from '../server/config.js'
import { formatCode } from '../server/codes.js'
import { getAssignment, listAssignments, listStudents, openDb, upsertAssignment } from '../server/db.js'
import type { Side } from '../shared/types.js'

const W = 1240
const H = 1754

interface Spec { student: string; name: string; assignment: string; title: string; page: number; side: Side; torn?: boolean; tag?: string }

// Use whatever roster and assignments are loaded. With nothing loaded yet,
// make a sample assignment for the first three active students.
openDb()
const active = listStudents().filter((s) => s.active)
const students = active.filter((s) => s.grade === active[0]?.grade && s.klass === active[0]?.klass).slice(0, 3)
if (students.length < 3) {
  console.error('Need at least three active students. Run npm run import:students -- your.csv or npm run seed:demo first.')
  process.exit(1)
}
let a = listAssignments().find((x) => x.klass === students[0].klass && (x.grade == null || x.grade === students[0].grade) && x.sheets >= 2 && x.twoSided)
let single = listAssignments().find((x) => x.klass === students[0].klass && (x.grade == null || x.grade === students[0].grade) && x.sheets === 1 && !x.twoSided)
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
const A = a.code, T = a.title, B = single.code, BT = single.title

const specs: Spec[] = [
  { student: s1.code, name: first(s1), assignment: A, title: T, page: 1, side: 'a' },
  { student: s1.code, name: first(s1), assignment: A, title: T, page: 1, side: 'b' },
  { student: s1.code, name: first(s1), assignment: A, title: T, page: 2, side: 'a' },
  { student: s1.code, name: first(s1), assignment: A, title: T, page: 2, side: 'b' },
  { student: s2.code, name: first(s2), assignment: A, title: T, page: 1, side: 'a' },
  { student: s2.code, name: first(s2), assignment: A, title: T, page: 1, side: 'b' },
  { student: s2.code, name: first(s2), assignment: A, title: T, page: 2, side: 'a' },
  { student: s2.code, name: first(s2), assignment: A, title: T, page: 2, side: 'b', torn: true },
  { student: s3.code, name: first(s3), assignment: A, title: T, page: 1, side: 'a' },
  { student: s3.code, name: first(s3), assignment: B, title: BT, page: 1, side: 'a' },
  { student: s2.code, name: first(s2), assignment: B, title: BT, page: 1, side: 'a' },
  { student: s1.code, name: first(s1), assignment: A, title: T, page: 1, side: 'a', tag: 'rescan' },
]

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;')

async function makePage(spec: Spec, i: number) {
  const code = formatCode(spec)
  const qrPng = await QRCode.toBuffer(code, { type: 'png', margin: 2, errorCorrectionLevel: 'H', width: 180 })
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
  // --nocode: work from before the codes existed, for trying File a stack
  const composites: sharp.OverlayOptions[] = process.argv.includes('--nocode') ? [] : [{ input: qrPng, left: W - 180 - 80, top: 80 }]
  if (spec.torn) {
    // A ragged white patch over most of the code, like a torn corner.
    const tear = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}"><polygon points="${W - 300},0 ${W},0 ${W},320 ${W - 120},300 ${W - 200},200 ${W - 260},120" fill="#ffffff"/></svg>`)
    composites.push({ input: tear, left: 0, top: 0 })
  }
  const out = path.join(INBOX_DIR, `inbox_${String(400 + i).padStart(4, '0')}${spec.tag ? '_' + spec.tag : ''}.jpg`)
  await sharp(Buffer.from(svg)).composite(composites).jpeg({ quality: 82 }).toFile(out)
  // Give each file a later mtime than the one before so scan order is unambiguous.
  const t = new Date(Date.now() - (specs.length - i) * 4000)
  fs.utimesSync(out, t, t)
  return out
}

fs.mkdirSync(INBOX_DIR, { recursive: true })
const made: string[] = []
for (let i = 0; i < specs.length; i++) {
  made.push(await makePage(specs[i], i))
  // Space them out a little so a running watcher sees them arrive one by one.
  if (process.argv.includes('--slow')) await new Promise((r) => setTimeout(r, 2500))
}
console.log(`Wrote ${made.length} sample pages for ${s1.name}, ${s2.name} and ${s3.name} on ${A} and ${B} to ${INBOX_DIR}`)
