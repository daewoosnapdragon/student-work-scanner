import path from 'node:path'
import fs from 'node:fs'

// Everything the scanner writes lives under DATA_DIR. The inbox is the folder
// the desk scanner drops files into; it can be anywhere on the machine.
const root = path.resolve(process.cwd())
export const DATA_DIR = path.resolve(process.env.SWS_DATA_DIR ?? path.join(root, 'data'))
export const INBOX_DIR = path.resolve(process.env.SWS_INBOX ?? path.join(DATA_DIR, 'inbox'))
export const ARCHIVE_DIR = path.join(DATA_DIR, 'archive') // filed pages
export const HOLDING_DIR = path.join(DATA_DIR, 'holding') // pages waiting in review
export const THUMBS_DIR = path.join(DATA_DIR, 'thumbs')
export const DB_PATH = path.join(DATA_DIR, 'scanner.sqlite')
export const PORT = Number(process.env.PORT ?? 4710)
// A packet that is still missing sides this long after its last page goes to review.
export const INCOMPLETE_AFTER_MIN = Number(process.env.SWS_INCOMPLETE_AFTER_MIN ?? 120)
export const PDF_DPI = Number(process.env.SWS_PDF_DPI ?? 200)

export function ensureDirs() {
  for (const d of [DATA_DIR, INBOX_DIR, ARCHIVE_DIR, HOLDING_DIR, THUMBS_DIR]) fs.mkdirSync(d, { recursive: true })
}
