import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import QRCode from 'qrcode'
import sharp from 'sharp'
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

  it('names reused PDF pages after the kept file, and a leftover page never joins a settled pile', async () => {
    // the first dup.pdf: no codes, named, and its first sheet sent loose, so index 1 is free in a settled pile
    await processAll(await pilePdf('dup.pdf', new Array(4).fill(null)))
    const first = filing.namePile(db.listPiles()[0].id, 'W14')
    filing.looseSheet(first.id, 1)
    expect(db.pilePages(first.id).map((p) => p.pileIndex)).toEqual([2, 3])

    // the second dup.pdf is kept as dup-2.pdf, and its pages carry that name
    const rendered = await pipeline.processInboxFile(await pilePdf('dup.pdf', ['SWS1:S01:W14:1A', 'SWS1:S01:W14:2A', 'SWS1:S01:W14:2B', 'SWS1:S01:W14:1B']))
    expect(rendered.map((f) => path.basename(f))).toEqual(['dup-2__p01.jpg', 'dup-2__p02.jpg', 'dup-2__p03.jpg', 'dup-2__p04.jpg'])
    const second = db.listPiles()[0]
    expect(second.origin).toBe('originals/dup-2.pdf')
    for (const f of rendered.slice(0, 3)) await pipeline.processInboxFile(f)
    pipeline.forgetRendered()
    await pipeline.processInboxFile(rendered[3])
    expect(db.pilePages(second.id)).toHaveLength(4)
    expect(db.getPile(second.id)!.status).toBe('done')

    // a stray page named after the first PDF finds the first pile settled, and stays out of it
    const stray = path.join(config.INBOX_DIR, 'dup__p01.jpg')
    await sharp({ create: { width: 200, height: 280, channels: 3, background: '#fff' } }).jpeg().toFile(stray)
    await pipeline.processInboxFile(stray)
    const p = db.reviewPages().at(-1)!
    expect(p).toMatchObject({ sourceName: 'dup__p01.jpg', origin: 'originals/dup.pdf', pile: null })
    expect(db.pilePages(first.id).map((x) => x.pileIndex)).toEqual([2, 3])
    expect(db.getPile(first.id)!.status).toBe('checking')
  })

  it('names a pile again after a sheet went loose, pairing by the PDF page count', async () => {
    await processAll(await pilePdf('gap.pdf', new Array(8).fill(null)))
    let pile = filing.namePile(db.listPiles()[0].id, 'W14')
    expect(pile.held.map((h) => h.sheet)).toEqual([1, 2, 3, 4])
    expect(db.getPage(pile.held[0].pages[0])!.reason).toBe(pile.held[0].why) // a held page says why
    filing.looseSheet(pile.id, 2)
    pile = filing.namePile(pile.id, 'W14')
    expect(pile.status).toBe('checking')
    expect(pile.held.map((h) => h.sheet)).toEqual([1, 3, 4])
    const at = (id: number | null) => (id == null ? null : db.getPage(id)!.pileIndex)
    expect(pile.held.map((h) => h.pages.map(at))).toEqual([[1, 8], [3, 6], [4, 5]])
  })

  it('leaves a pile that never got every page waiting, and settles it when named', async () => {
    const rendered = await pipeline.processInboxFile(await pilePdf('short.pdf', new Array(4).fill(null)))
    for (const f of rendered.slice(0, 3)) await pipeline.processInboxFile(f)
    fs.rmSync(rendered[3]) // the last page never arrives
    let pile = db.listPiles()[0]
    expect(pile.status).toBe('new')
    pile = filing.namePile(pile.id, 'W14')
    expect(pile.status).toBe('checking')
    expect(pile.held.map((h) => h.sheet)).toEqual([1, 2])
    const at = (id: number | null) => (id == null ? null : db.getPage(id)!.pileIndex)
    expect(pile.held.map((h) => h.pages.map(at))).toEqual([[1, null], [2, 3]])
  })

  it('refuses to name a pile while its pages are still arriving, and settles it by itself once they are in', async () => {
    const rendered = await pipeline.processInboxFile(await pilePdf('arrive.pdf', ['SWS1:S01:W14:1A', 'SWS1:S01:W14:2A', 'SWS1:S01:W14:2B', 'SWS1:S01:W14:1B']))
    for (const f of rendered.slice(0, 2)) await pipeline.processInboxFile(f)
    const pile = db.listPiles()[0]
    expect(() => filing.namePile(pile.id, 'W14')).toThrow(/still arriving, 2 of 4 pages in/)
    expect(db.getPile(pile.id)!.assignment).toBeNull()
    for (const f of rendered.slice(2)) await pipeline.processInboxFile(f)
    expect(db.getPile(pile.id)!.status).toBe('done')
  })

  it('sends a late page of a pile that was settled meanwhile loose, never strands it in the pile', async () => {
    // by name, after a restart: the pile was named once it stopped arriving
    let rendered = await pipeline.processInboxFile(await pilePdf('late.pdf', new Array(4).fill(null)))
    for (const f of rendered.slice(0, 3)) await pipeline.processInboxFile(f)
    pipeline.forgetRendered()
    const named = filing.namePile(db.listPiles()[0].id, 'W14')
    expect(named.status).toBe('checking')
    await pipeline.processInboxFile(rendered[3])
    expect(db.reviewPages().at(-1)).toMatchObject({ sourceName: 'late__p04.jpg', pile: null })
    expect(db.pilePages(named.id)).toHaveLength(3)

    // still remembered from this run, but the pile settled meanwhile
    rendered = await pipeline.processInboxFile(await pilePdf('late2.pdf', new Array(4).fill(null)))
    for (const f of rendered.slice(0, 3)) await pipeline.processInboxFile(f)
    const pile = db.listPiles()[0]
    db.updatePile(pile.id, { status: 'checking', settledAt: new Date().toISOString() })
    await pipeline.processInboxFile(rendered[3])
    expect(db.reviewPages().at(-1)).toMatchObject({ sourceName: 'late2__p04.jpg', pile: null })
    expect(db.pilePages(pile.id)).toHaveLength(3)
  })

  it('counts a page still decoding as arriving, so the pile cannot be named under it', async () => {
    const rendered = await pipeline.processInboxFile(await pilePdf('flight.pdf', ['SWS1:S01:W14:1A', 'SWS1:S01:W14:2A', 'SWS1:S01:W14:2B', 'SWS1:S01:W14:1B']))
    for (const f of rendered.slice(0, 3)) await pipeline.processInboxFile(f)
    const pile = db.listPiles()[0]
    const last = pipeline.processInboxFile(rendered[3]) // its decode is pending
    expect(pipeline.pileArriving(pile.id)).toBe(true)
    expect(() => filing.namePile(pile.id, 'W14')).toThrow(/still arriving, 3 of 4 pages in/)
    await last
    expect(pipeline.pileArriving(pile.id)).toBe(false)
    expect(db.getPile(pile.id)!.status).toBe('done')
    expect(db.pilePages(pile.id)).toHaveLength(4)
  })

  it('inserts a page loose when its pile was settled while it decoded', async () => {
    const rendered = await pipeline.processInboxFile(await pilePdf('settled.pdf', new Array(2).fill(null)))
    const pile = db.listPiles()[0]
    db.updatePile(pile.id, { status: 'checking', settledAt: new Date().toISOString() })
    const p = await pipeline.processImage(rendered[0], 'settled__p01.jpg', { origin: pile.origin, originPage: 1 }, { id: pile.id, index: 1 })
    expect(p).toMatchObject({ status: 'review', pile: null, origin: pile.origin })
    expect(p.reason).not.toBe('in pile')
    expect(db.pilePages(pile.id)).toEqual([])
    fs.rmSync(rendered[1])
  })

  it('sends a page loose when its code reads but cannot be filed', async () => {
    db.upsertStudent({ code: 'S09', name: 'Gone', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
    const rendered = await pipeline.processInboxFile(await pilePdf('gone.pdf', ['SWS1:S09:W14:1A', 'SWS1:S09:W14:2A', 'SWS1:S09:W14:2B', 'SWS1:S09:W14:1B']))
    db.getDb().prepare("DELETE FROM students WHERE code = 'S09'").run() // gone from the roster before the pile settles
    for (const f of rendered) await pipeline.processInboxFile(f)
    const pile = db.listPiles()[0]
    expect(pile.status).toBe('done')
    expect(db.pilePages(pile.id)).toEqual([])
    const loose = db.reviewPages().filter((p) => p.sourceName.startsWith('gone__'))
    expect(loose).toHaveLength(4)
    expect(loose.every((p) => p.pile === null && /no student S09/.test(p.reason ?? ''))).toBe(true)
  })
})

describe('undo', () => {
  async function settledPile(name: string, codes: string[]) {
    await processAll(await pilePdf(name, codes))
    return db.listPiles().find((x) => x.origin.endsWith(name) || db.pilePages(x.id).some((p) => p.sourceName.startsWith(name.replace('.pdf', '__'))))!
  }

  it('undo puts a pile back as it arrived, restores what it replaced, and keeps a scored packet', async () => {
    db.upsertAssignment({ code: 'W23', title: 'Week 23', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null })
    const first = await settledPile('undo-first.pdf', ['SWS1:S01:W23:1A'])
    const originalId = db.pilePages(first.id)[0].id
    expect(db.getPage(originalId)).toMatchObject({ status: 'filed', student: 'S01', assignment: 'W23' })
    db.setPacketScore('S01', 'W23', 3, 4, null)
    const pile = await settledPile('undo-second.pdf', ['SWS1:S01:W23:1A', 'SWS1:S01:W23:2A', 'SWS1:S01:W23:2B', 'SWS1:S01:W23:1B'])
    expect(db.getPile(pile.id)!.status).toBe('done')
    expect(db.getPage(originalId)!.status).toBe('replaced')
    const filing2 = filing.undoPile(pile.id)
    expect(filing2.id).toBe(pile.id)
    expect(db.getPile(pile.id)).toMatchObject({ status: 'new', assignment: null, held: [], sheets: null, twoSided: null, settledAt: null })
    const pages = db.pilePages(pile.id)
    expect(pages).toHaveLength(4)
    expect(pages.every((p) => p.status === 'review' && p.reason === 'in pile' && p.filedFrom === null)).toBe(true)
    // as they arrived: the code each page read is still on it
    expect(pages.map((p) => `${p.student}:${p.assignment}:${p.page}${p.side}`)).toEqual(['S01:W23:1a', 'S01:W23:2a', 'S01:W23:2b', 'S01:W23:1b'])
    expect(pages.every((p) => fs.existsSync(path.join(config.DATA_DIR, p.filePath)) && p.filePath.startsWith('holding'))).toBe(true)
    expect(db.getPage(originalId)).toMatchObject({ status: 'filed' })
    expect(db.packetPages('S01', 'W23').map((p) => p.id)).toEqual([originalId])
    expect(db.getPacket('S01', 'W23')).toMatchObject({ score: 3, sides: 1 })
  })

  it('undo deletes a packet that carries nothing', async () => {
    const pile = await settledPile('undo-bare.pdf', ['SWS1:S02:W23:1A', 'SWS1:S02:W23:2A', 'SWS1:S02:W23:2B', 'SWS1:S02:W23:1B'])
    expect(db.getPacket('S02', 'W23')).toMatchObject({ sides: 4 })
    filing.undoPile(pile.id)
    expect(db.getPacket('S02', 'W23')).toBeUndefined()
    expect(db.getPile(pile.id)!.status).toBe('new')
      // the codes came back with the pages, so it settles by them again
    expect(filing.namePile(pile.id, 'W23').status).toBe('done')
    expect(db.pilePages(pile.id).every((p) => p.status === 'filed' && p.filedFrom === 'code')).toBe(true)
  })

  function assignment(code: string) {
    db.upsertAssignment({ code, title: code, klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null })
  }
  const codesFor = (student: string, a: string) => [`SWS1:${student}:${a}:1A`, `SWS1:${student}:${a}:2A`, `SWS1:${student}:${a}:2B`, `SWS1:${student}:${a}:1B`]

  it('undo still works when a replaced scan cannot be restored', async () => {
    assignment('W26')
    const first = await settledPile('undo-gone1.pdf', ['SWS1:S03:W26:1A'])
    const originalId = db.pilePages(first.id)[0].id
    const pile = await settledPile('undo-gone2.pdf', codesFor('S03', 'W26'))
    const old = db.getPage(originalId)!
    expect(old.status).toBe('replaced')
    fs.rmSync(path.join(config.DATA_DIR, old.filePath)) // the kept file is gone
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const out = filing.undoPile(pile.id)
    expect(warn).toHaveBeenCalled()
    warn.mockRestore()
    expect(out.status).toBe('new')
    const pages = db.pilePages(pile.id)
    expect(pages).toHaveLength(4)
    expect(pages.every((p) => p.status === 'review' && p.reason === 'in pile')).toBe(true)
    expect(db.getPage(originalId)!.status).toBe('replaced')
  })

  it('undo takes back not_work pages, marks held pages, leaves loose pages loose, and tolerates a second undo', async () => {
    assignment('W24')
    const pile = await settledPile('undo-mixed.pdf', codesFor('S01', 'W24'))
    const [a, b, c, d] = db.pilePages(pile.id)
    db.updatePage(a.id, { status: 'not_work', student: null, assignment: null, page: null, side: null })
    db.updatePage(b.id, { status: 'review', reason: 'held for a check', student: null, assignment: null, page: null, side: null })
    db.updatePage(c.id, { status: 'review', pile: null, reason: 'left loose', student: null, assignment: null, page: null, side: null })
    filing.undoPile(pile.id)
    expect(db.getPage(a.id)).toMatchObject({ status: 'review', reason: 'in pile', pile: pile.id })
    expect(fs.existsSync(path.join(config.DATA_DIR, db.getPage(a.id)!.filePath))).toBe(true)
    expect(db.getPage(b.id)).toMatchObject({ status: 'review', reason: 'in pile', pile: pile.id, student: null, filePath: b.filePath })
    expect(db.getPage(c.id)).toMatchObject({ status: 'review', pile: null, reason: 'left loose' })
    expect(db.getPage(d.id)).toMatchObject({ status: 'review', reason: 'in pile', student: 'S01', assignment: 'W24' })
    expect(db.getPacket('S01', 'W24')).toBeUndefined()
    const again = filing.undoPile(pile.id)
    expect(again).toMatchObject({ status: 'new', assignment: null, held: [] })
    expect(db.pilePages(pile.id).every((p) => p.status === 'review' && p.reason === 'in pile')).toBe(true)
    expect(db.getPage(c.id)).toMatchObject({ pile: null })
  })

  it('undo keeps a packet that carries a note, with no sides, and a second undo leaves it', async () => {
    assignment('W25')
    const pile = await settledPile('undo-note.pdf', codesFor('S02', 'W25'))
    db.setPacketNote('S02', 'W25', 'Good start')
    filing.undoPile(pile.id)
    expect(db.getPacket('S02', 'W25')).toMatchObject({ sides: 0, complete: 0, note: 'Good start' })
    filing.undoPile(pile.id)
    expect(db.getPacket('S02', 'W25')).toMatchObject({ sides: 0, note: 'Good start' })
  })
})
