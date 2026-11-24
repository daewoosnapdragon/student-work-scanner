import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { PDFDocument } from 'pdf-lib'

// The pipeline reads its folders from the environment when it loads, so the
// data dir is pointed at a scratch folder before anything is imported.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sws-pdf-'))
process.env.SWS_DATA_DIR = tmp
process.env.SWS_PDF_DPI = '40'

let pipeline: typeof import('../server/pipeline.js')
let db: typeof import('../server/db.js')
let config: typeof import('../server/config.js')

beforeAll(async () => {
  config = await import('../server/config.js')
  db = await import('../server/db.js')
  pipeline = await import('../server/pipeline.js')
  config.ensureDirs()
  db.openDb(':memory:')
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

async function writePdf(name: string, pages: number) {
  const doc = await PDFDocument.create()
  for (let i = 0; i < pages; i++) doc.addPage([200, 280])
  const file = path.join(config.INBOX_DIR, name)
  fs.writeFileSync(file, await doc.save())
  return file
}

describe('a PDF from the scanner', () => {
  it('is kept under originals after its pages are rendered, and each page remembers where it came from', async () => {
    const pdf = await writePdf('scan001.pdf', 2)
    const rendered = await pipeline.processInboxFile(pdf)
    expect(rendered).toHaveLength(2)
    expect(fs.existsSync(pdf)).toBe(false)
    const kept = path.join(config.ORIGINALS_DIR, 'scan001.pdf')
    expect(fs.existsSync(kept)).toBe(true)

    const pages = []
    for (const f of rendered) {
      await pipeline.processInboxFile(f)
      pages.push(db.reviewPages().at(-1)!)
    }
    expect(pages.map((p) => [p.origin, p.originPage])).toEqual([['originals/scan001.pdf', 1], ['originals/scan001.pdf', 2]])
    // held in their pile; with no codes the pile waits to be named, and the pages wait in it
    expect(pages.map((p) => p.reason)).toEqual(['in pile', 'in pile'])
    expect(db.listPiles()[0]).toMatchObject({ origin: 'originals/scan001.pdf', pages: 2, status: 'new', assignment: null })
  })
  it('does not overwrite an earlier original of the same name', async () => {
    const pdf = await writePdf('scan001.pdf', 1)
    const [page] = await pipeline.processInboxFile(pdf)
    expect(fs.existsSync(path.join(config.ORIGINALS_DIR, 'scan001.pdf'))).toBe(true)
    expect(fs.existsSync(path.join(config.ORIGINALS_DIR, 'scan001-2.pdf'))).toBe(true)
    await pipeline.processInboxFile(page)
    expect(db.reviewPages().at(-1)!.origin).toBe('originals/scan001-2.pdf')
  })
  it('finds the original by name for a rendered page left over from before a restart', async () => {
    // the in-memory link is gone, but the name still says which PDF it came from
    const left = path.join(config.INBOX_DIR, 'scan001__p02.jpg')
    fs.copyFileSync(path.join(config.ORIGINALS_DIR, 'scan001.pdf'), path.join(tmp, 'ignore.pdf'))
    const { default: sharp } = await import('sharp')
    await sharp({ create: { width: 60, height: 80, channels: 3, background: '#fff' } }).jpeg().toFile(left)
    await pipeline.processInboxFile(left)
    const p = db.reviewPages().at(-1)!
    expect(p.origin).toBe('originals/scan001.pdf')
    expect(p.originPage).toBe(2)
  })
})
