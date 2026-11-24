import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import QRCode from 'qrcode'
import { PDFDocument } from 'pdf-lib'

// The pipeline reads its folders from the environment when it loads, so the
// data dir is pointed at a scratch folder before anything is imported.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sws-pile-'))
process.env.SWS_DATA_DIR = tmp
process.env.SWS_PDF_DPI = '60'

let pipeline: typeof import('../server/pipeline.js')
let filing: typeof import('../server/pileFiling.js')
let db: typeof import('../server/db.js')
let config: typeof import('../server/config.js')

beforeAll(async () => {
  config = await import('../server/config.js')
  db = await import('../server/db.js')
  pipeline = await import('../server/pipeline.js')
  filing = await import('../server/pileFiling.js')
  config.ensureDirs()
  db.openDb(':memory:')
  db.upsertStudent({ code: 'S01', name: 'Ara', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertStudent({ code: 'S02', name: 'Bo', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertStudent({ code: 'S03', name: 'Cho', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertAssignment({ code: 'W14', title: 'Week 14', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null })
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

// A PDF in the inbox whose page i carries the code codes[i] in its top right corner, or nothing.
async function pilePdf(name: string, codes: Array<string | null>) {
  const doc = await PDFDocument.create()
  for (const code of codes) {
    const page = doc.addPage([400, 560])
    if (!code) continue
    const png = await QRCode.toBuffer(code, { type: 'png', margin: 2, errorCorrectionLevel: 'H', width: 180 })
    const img = await doc.embedPng(png)
    page.drawImage(img, { x: 400 - 150 - 16, y: 560 - 150 - 16, width: 150, height: 150 })
  }
  const file = path.join(config.INBOX_DIR, name)
  fs.writeFileSync(file, await doc.save())
  return file
}

async function processAll(pdf: string) {
  const rendered = await pipeline.processInboxFile(pdf)
  for (const f of rendered) await pipeline.processInboxFile(f)
  return rendered
}

const CLEAN = [
  'SWS1:S01:W14:1A', 'SWS1:S01:W14:2A', 'SWS1:S02:W14:1A', 'SWS1:S02:W14:2A',
  'SWS1:S02:W14:2B', 'SWS1:S02:W14:1B', 'SWS1:S01:W14:2B', 'SWS1:S01:W14:1B',
]

describe('a PDF settles as a pile', () => {
  it('files a clean pile and reports it done', async () => {
    await processAll(await pilePdf('p1.pdf', CLEAN))
    const pile = db.listPiles()[0]
    expect(pile).toMatchObject({ assignment: 'W14', status: 'done', sheets: 4, twoSided: 1, pages: 8 })
    expect(db.getPacket('S01', 'W14')).toMatchObject({ sides: 4, complete: 1 })
    expect(db.reviewPages()).toEqual([])
  })

  it('holds a sheet and files it from the check', async () => {
    // page 6 is the back of S02's sheet 1 but carries S03's code: a contradiction
    const codes = [...CLEAN]
    codes[5] = 'SWS1:S03:W14:1B'
    await processAll(await pilePdf('p2.pdf', codes))
    const pile = db.listPiles()[0]
    expect(pile.status).toBe('checking')
    expect(pile.held).toHaveLength(1)
    expect(pile.held[0].why).toMatch(/contradict/)
    expect(pile.held[0].guesses.map((g) => g.student).sort()).toEqual(['S02', 'S03'])
    expect(pile.held[0].guesses[0]).toMatchObject({ student: 'S02', studentName: 'Bo', page: 1 }) // S02 fits the run around it
    filing.fileSheet(pile.id, pile.held[0].sheet, 'S02', 1)
    expect(db.getPile(pile.id)!.status).toBe('done')
    expect(db.packetPages('S02', 'W14').map((p) => `${p.page}${p.side}:${p.filedFrom}`).sort()).toEqual(['1a:review', '1b:review', '2a:code', '2b:code'])
  })

  it('waits with no codes until named, then offers packets and files them all', async () => {
    await processAll(await pilePdf('p3.pdf', new Array(4).fill(null)))
    let pile = db.listPiles()[0]
    expect(pile.status).toBe('new')
    expect(db.reviewPages().every((p) => p.reason === 'in pile')).toBe(true)
    pile = filing.namePile(pile.id, 'W14')
    expect(pile.status).toBe('checking')
    const r = filing.fileAllPackets(pile.id, [{ sheets: [1, 2], student: 'S03' }])
    expect(r).toEqual({ filed: 4, failed: [] })
    expect(db.getPacket('S03', 'W14')).toMatchObject({ sides: 4 })
  })

  it('rejoins a pile after a restart from the rendered names', async () => {
    const rendered = await pipeline.processInboxFile(await pilePdf('p4.pdf', ['SWS1:S01:W14:1A', 'SWS1:S01:W14:2A', 'SWS1:S01:W14:2B', 'SWS1:S01:W14:1B']))
    for (const f of rendered.slice(0, 3)) await pipeline.processInboxFile(f)
    expect(db.listPiles()[0].status).toBe('new')
    pipeline.forgetRendered()
    await pipeline.processInboxFile(rendered[3])
    expect(db.listPiles()[0].status).toBe('done')
  })
})
