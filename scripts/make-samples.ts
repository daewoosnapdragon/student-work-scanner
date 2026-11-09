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
import type { Side } from '../shared/types.js'

const W = 1240
const H = 1754

interface Spec { student: string; name: string; assignment: string; title: string; page: number; side: Side; torn?: boolean; tag?: string }

const specs: Spec[] = [
  { student: 'S03', name: 'Jiwoo Kim', assignment: 'W23', title: 'Short Vowel Sort', page: 1, side: 'a' },
  { student: 'S03', name: 'Jiwoo Kim', assignment: 'W23', title: 'Short Vowel Sort', page: 1, side: 'b' },
  { student: 'S03', name: 'Jiwoo Kim', assignment: 'W23', title: 'Short Vowel Sort', page: 2, side: 'a' },
  { student: 'S03', name: 'Jiwoo Kim', assignment: 'W23', title: 'Short Vowel Sort', page: 2, side: 'b' },
  { student: 'S07', name: 'Minji Park', assignment: 'W23', title: 'Short Vowel Sort', page: 1, side: 'a' },
  { student: 'S07', name: 'Minji Park', assignment: 'W23', title: 'Short Vowel Sort', page: 1, side: 'b' },
  { student: 'S07', name: 'Minji Park', assignment: 'W23', title: 'Short Vowel Sort', page: 2, side: 'a' },
  { student: 'S07', name: 'Minji Park', assignment: 'W23', title: 'Short Vowel Sort', page: 2, side: 'b', torn: true },
  { student: 'S04', name: 'Seoyeon Lee', assignment: 'W23', title: 'Short Vowel Sort', page: 1, side: 'a' },
  { student: 'S04', name: 'Seoyeon Lee', assignment: 'W22', title: 'Weekend Writing', page: 1, side: 'a' },
  { student: 'S07', name: 'Minji Park', assignment: 'W22', title: 'Weekend Writing', page: 1, side: 'a' },
  { student: 'S03', name: 'Jiwoo Kim', assignment: 'W23', title: 'Short Vowel Sort', page: 1, side: 'a', tag: 'rescan' },
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
  const composites: sharp.OverlayOptions[] = [{ input: qrPng, left: W - 180 - 80, top: 80 }]
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
console.log(`Wrote ${made.length} sample pages to ${INBOX_DIR}`)
