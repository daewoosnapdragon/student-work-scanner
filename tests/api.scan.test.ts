import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { AddressInfo } from 'node:net'
import type { Server } from 'node:http'
import QRCode from 'qrcode'
import sharp from 'sharp'
import { PDFDocument } from 'pdf-lib'

// The pipeline reads its folders from the environment when it loads, so the
// data dir is pointed at a scratch folder before anything is imported.
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sws-api-scan-'))
process.env.SWS_DATA_DIR = tmp
process.env.SWS_PDF_DPI = '60'
delete process.env.ANTHROPIC_API_KEY

let pipeline: typeof import('../server/pipeline.js')
let db: typeof import('../server/db.js')
let config: typeof import('../server/config.js')
let server: Server
let base = ''

beforeAll(async () => {
  config = await import('../server/config.js')
  db = await import('../server/db.js')
  pipeline = await import('../server/pipeline.js')
  const { makeApp } = await import('../server/app.js')
  config.ensureDirs()
  db.openDb(':memory:')
  db.upsertStudent({ code: 'S01', name: 'Ara', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertStudent({ code: 'S02', name: 'Bo', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertStudent({ code: 'S03', name: 'Cho', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertStudent({ code: 'S04', name: 'Dae', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertAssignment({ code: 'W14', title: 'Week 14', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null })
  server = makeApp().listen(0)
  await new Promise<void>((resolve) => server.once('listening', () => resolve()))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(async () => {
  if (server) await new Promise<void>((resolve) => server.close(() => resolve()))
  fs.rmSync(tmp, { recursive: true, force: true })
})

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

async function get<T = any>(url: string): Promise<{ status: number; body: T }> {
  const r = await fetch(base + url)
  return { status: r.status, body: (await r.json()) as T }
}
async function post<T = any>(url: string, body: unknown = {}): Promise<{ status: number; body: T }> {
  const r = await fetch(base + url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  return { status: r.status, body: (await r.json()) as T }
}

const CLEAN = [
  'SWS1:S01:W14:1A', 'SWS1:S01:W14:2A', 'SWS1:S02:W14:1A', 'SWS1:S02:W14:2A',
  'SWS1:S02:W14:2B', 'SWS1:S02:W14:1B', 'SWS1:S01:W14:2B', 'SWS1:S01:W14:1B',
]

describe('scan and pile routes', () => {
  let pileId = 0

  it('lists a pile with a held sheet on the scan screen', async () => {
    // page 6 is the back of S02's sheet 1 but carries S03's code: a contradiction, so sheet 3 is held
    const codes = [...CLEAN]
    codes[5] = 'SWS1:S03:W14:1B'
    await processAll(await pilePdf('held.pdf', codes))
    const { status, body } = await get('/api/scan')
    expect(status).toBe(200)
    expect(body.status.folder).toBe(path.basename(config.INBOX_DIR))
    expect(body.loose).toBe(0)
    expect(body.piles).toHaveLength(1)
    expect(body.piles[0]).toMatchObject({ assignment: 'W14', assignmentTitle: 'Week 14', status: 'checking', toCheck: 1, filed: 3, looseFrom: 0 })
    pileId = body.piles[0].id
  })

  it('shows the pile, its sheets and the held sheet with both pages', async () => {
    const { status, body } = await get(`/api/piles/${pileId}`)
    expect(status).toBe(200)
    expect(body.pile.id).toBe(pileId)
    expect(body.assignment.code).toBe('W14')
    expect(body.sheets).toHaveLength(4)
    expect(body.sheets.map((s: any) => s.status)).toEqual(['filed', 'filed', 'held', 'filed'])
    expect(body.sheets[0]).toMatchObject({ sheet: 1, student: 'S01', studentName: 'Ara' })
    expect(body.sheets[2].front.pileIndex).toBe(3)
    expect(body.sheets[2].back.pileIndex).toBe(6)
    expect(body.held).toHaveLength(1)
    expect(body.held[0].pages.filter((id: number | null) => id != null)).toHaveLength(2)
    expect(body.held[0].thumbs).toHaveLength(2)
    expect(body.packets).toBeUndefined()
    expect(body.roster.map((s: any) => s.name)).toEqual(['Ara', 'Bo', 'Cho', 'Dae'])
    expect((await get('/api/piles/9999')).status).toBe(404)
  })

  it('files the held sheet and empties held', async () => {
    const bad = await post(`/api/piles/${pileId}/sheets/3/file`, { student: 'NOPE', page: 1 })
    expect(bad.status).toBe(400)
    const { status, body } = await post(`/api/piles/${pileId}/sheets/3/file`, { student: 'S02', page: 1 })
    expect(status).toBe(200)
    expect(body.held).toEqual([])
    expect(body.pile.status).toBe('done')
    expect(db.getPile(pileId)!.held).toEqual([])
    expect(db.getPacket('S02', 'W14')).toMatchObject({ sides: 4, complete: 1 })
  })

  it('says scanning for an assignment with nothing turned in yet', async () => {
    db.upsertAssignment({ code: 'W15', title: 'Week 15', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 1, twoSided: 0, tags: '', notes: null })
    const row = (await get('/api/assignments')).body.find((a: any) => a.code === 'W15')
    expect(row).toMatchObject({ stage: 'scanning', turnedIn: 0, pileId: null })
  })

  it('gives each assignment its stage, what is left to check and who is not in', async () => {
    const { body } = await get('/api/assignments')
    const row = body.find((a: any) => a.code === 'W14')
    expect(row).toMatchObject({ stage: 'ready', toCheck: 0, missingSide: 0, analysed: 0, notIn: ['Cho', 'Dae'], noticing: null, pileId: null, turnedIn: 2, roster: 4 })
    expect((await get('/api/assignments/W14')).body.pileId).toBeNull()
  })

  it('says scanning while a pile for the assignment is unnamed or has sheets to check', async () => {
    // no codes: the pile waits to be named
    await processAll(await pilePdf('blank.pdf', new Array(4).fill(null)))
    const scan = (await get('/api/scan')).body
    const blank = scan.piles[0]
    expect(blank).toMatchObject({ status: 'new', assignment: null, codeAssignment: null, toCheck: 0 })
    expect((await post(`/api/piles/${blank.id}/assignment`, { code: 'W99' })).status).toBe(400)
    const named = await post(`/api/piles/${blank.id}/assignment`, { code: 'W14' })
    expect(named.status).toBe(200)
    expect(named.body.pile.status).toBe('checking')
    expect(named.body.packets).toEqual([{ sheets: [1, 2], student: expect.any(String), pages: expect.any(Array) }])
    expect(named.body.packets[0].pages).toHaveLength(4)
    const row = (await get('/api/assignments')).body.find((a: any) => a.code === 'W14')
    expect(row).toMatchObject({ stage: 'scanning', toCheck: 2, pileId: blank.id })
    expect((await get('/api/assignments/W14')).body.pileId).toBe(blank.id)

    // sent loose sheet by sheet: the pile is done, and its pages are loose
    expect((await post(`/api/piles/${blank.id}/sheets/1/loose`)).status).toBe(200)
    const after = await post(`/api/piles/${blank.id}/sheets/2/loose`)
    expect(after.body.pile.status).toBe('done')
    expect(after.body.sheets.map((s: any) => s.status)).toEqual(['loose', 'loose'])
    const scan2 = (await get('/api/scan')).body
    expect(scan2.loose).toBe(4)
    // looseFrom counts pages: two sheets, front and back
    expect(scan2.piles[0]).toMatchObject({ id: blank.id, looseFrom: 4, filed: 0, toCheck: 0 })
    const review = (await get('/api/review')).body
    expect(review.items).toHaveLength(4)
    expect(review.items.every((i: any) => i.kind === 'page')).toBe(true)
    expect(Object.keys(review.pages)).toHaveLength(4)
  })

  it('creates an assignment from the codes a pile read, then names the pile', async () => {
    db.upsertStudent({ code: 'S11', name: 'Eun', nameKo: null, klass: 'Rose', grade: 4, homeroom: null })
    await processAll(await pilePdf('new.pdf', ['SWS1:S11:W30:1A', 'SWS1:S11:W30:2A']))
    const pile = (await get('/api/scan')).body.piles[0]
    // the codes name W30, which does not exist yet: the scan screen offers it as the new assignment's code
    expect(pile).toMatchObject({ status: 'new', assignment: null, codeAssignment: 'W30' })
    const { status, body } = await post(`/api/piles/${pile.id}/assignment`, { code: 'w30', title: 'Rivers' })
    expect(status).toBe(200)
    expect(body.assignment).toMatchObject({ code: 'W30', title: 'Rivers', klass: 'Rose', grade: 4, sheets: 2, twoSided: 0 })
    expect(body.pile.status).toBe('done')
    expect(db.getPacket('S11', 'W30')).toMatchObject({ sides: 2, complete: 1 })
    // undo takes it back
    const undone = await post(`/api/piles/${pile.id}/undo`)
    expect(undone.status).toBe(200)
    expect(undone.body.pile.status).toBe('new')
    expect(db.getPacket('S11', 'W30')).toBeUndefined()
  })

  it('returns the page-by-page log, and /api/today is gone', async () => {
    const { body } = await get('/api/scan/log')
    expect(Array.isArray(body)).toBe(true)
    expect(body.length).toBeGreaterThan(0)
    expect(body[0]).toHaveProperty('studentName')
    expect((await fetch(`${base}/api/today`)).status).toBe(404)
  })

  it('closes the open packets before it asks for a key', async () => {
    // a single image with one front of S04's packet: filed by its code, the packet open
    const png = await QRCode.toBuffer('SWS1:S04:W14:1A', { type: 'png', margin: 2, errorCorrectionLevel: 'H', width: 300 })
    const img = path.join(config.INBOX_DIR, 'one.jpg')
    await sharp({ create: { width: 800, height: 1100, channels: 3, background: '#fff' } }).composite([{ input: png, top: 20, left: 480 }]).jpeg().toFile(img)
    await pipeline.processInboxFile(img)
    expect(db.getPacket('S04', 'W14')).toMatchObject({ sides: 1, complete: 0 })
    const row = (await get('/api/assignments')).body.find((a: any) => a.code === 'W14')
    expect(row.missingSide).toBe(1)
    expect(row.notIn).toEqual(['Cho'])
    // a packet with no side filed is not in, not short a side: it stays open
    db.refreshPacket('S03', 'W14', new Date().toISOString())
    expect((await get('/api/assignments')).body.find((a: any) => a.code === 'W14').missingSide).toBe(1)
    const r = await post('/api/analyse/assignment/W14', { closeIncomplete: true })
    expect(r.status).toBe(400)
    expect(db.getPacket('S04', 'W14')).toMatchObject({ complete: 1, closedIncomplete: 1 })
    expect(db.getPacket('S03', 'W14')).toMatchObject({ sides: 0, complete: 0, closedIncomplete: 0 })
    db.deletePacket('S03', 'W14')
  })

  it('marks feedback printed when the whole class is printed', async () => {
    db.setPacketFeedback('S01', 'W14', 'Well done.')
    db.markAnalysed('S01', 'W14')
    db.markAnalysed('S02', 'W14')
    db.markAnalysed('S04', 'W14')
    expect((await get('/api/assignments')).body.find((a: any) => a.code === 'W14')).toMatchObject({ stage: 'analysed', analysed: 3 })
    const r = await fetch(`${base}/print/feedback/W14/S01`)
    expect(r.status).toBe(200)
    expect(db.getPacket('S01', 'W14')!.feedbackPrintedAt).toBeNull()
    expect((await fetch(`${base}/print/feedback/W14`)).status).toBe(200)
    expect(db.packetsForAssignment('W14').every((p) => p.feedbackPrintedAt)).toBe(true)
    expect((await get('/api/assignments')).body.find((a: any) => a.code === 'W14').stage).toBe('done')
  })
  it('skips only loose pages when everything in the queue is skipped', async () => {
    db.upsertAssignment({ code: 'W40', title: 'Week 40', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null })
    const codes = CLEAN.map((c) => c.replace(':W14:', ':W40:'))
    codes[5] = 'SWS1:S03:W40:1B'
    await processAll(await pilePdf('skip.pdf', codes))
    const pile = db.listPiles()[0]
    expect(pile).toMatchObject({ assignment: 'W40', status: 'checking' })
    expect(pile.held).toHaveLength(1)
    const inPile = db.reviewPages().filter((p) => p.pile != null)
    expect(inPile.length).toBeGreaterThan(2) // the held sheet's pages and the undone W30 pile's
    const loose = db.reviewPages().filter((p) => p.pile == null)
    expect(loose.length).toBeGreaterThan(0)
    const r = await post('/api/review/skip-all')
    expect(r.body.skipped).toBe(loose.length)
    for (const p of loose) expect(db.getPage(p.id)!.status).toBe('skipped')
    for (const p of inPile) expect(db.getPage(p.id)).toMatchObject({ status: 'review', pile: p.pile, reason: p.reason })
    expect(db.getPile(pile.id)!.held).toEqual(pile.held)
  })
})

describe('scan and pile routes: final review fixes', () => {
  const w = (code: string, sheets: number, twoSided: number, klass = 'Daisy') =>
    db.upsertAssignment({ code, title: code, klass, grade: klass === 'Daisy' ? 3 : 4, assignedOn: null, sheets, twoSided, tags: '', notes: null })
  const scanRow = async (id: number) => (await get('/api/scan')).body.piles.find((p: any) => p.id === id)

  it('offers packets only for a pile that read no code, and says so on the pile', async () => {
    w('W50', 2, 1)
    await processAll(await pilePdf('single50.pdf', ['SWS1:S03:W50:1A', 'SWS1:S03:W50:1B']))
    const one = (await get(`/api/piles/${db.listPiles()[0].id}`)).body
    expect(one.pile).toMatchObject({ status: 'done', mode: null })
    expect(one.packets).toBeUndefined()
    expect(db.getPacket('S03', 'W50')).toMatchObject({ sides: 2 })

    await processAll(await pilePdf('blank50.pdf', [null, null]))
    const named = await post(`/api/piles/${db.listPiles()[0].id}/assignment`, { code: 'W50' })
    expect(named.body.pile).toMatchObject({ status: 'checking', mode: 'packets' })
    expect(named.body.packets).toHaveLength(1)
  })

  it('settles again only a pile that is waiting to be named', async () => {
    const done = db.listPiles().find((p) => p.status === 'done')!
    const r = await post(`/api/piles/${done.id}/settle`)
    expect(r.status).toBe(400)
    expect(r.body.error).toMatch(/settled/)
  })

  it('marks a guess for a sheet the student already has', async () => {
    w('W51', 2, 0)
    await processAll(await pilePdf('already51.pdf', ['SWS1:S01:W51:1A', null, 'SWS1:S01:W51:2A']))
    const body = (await get(`/api/piles/${db.listPiles()[0].id}`)).body
    expect(body.held).toHaveLength(1)
    expect(body.held[0].guesses).toEqual([expect.objectContaining({ student: 'S01', page: 2, already: true })])
  })

  it('says what the codes of a waiting pile name, and whether that assignment is set up', async () => {
    await processAll(await pilePdf('w31.pdf', ['SWS1:S11:W31:1A']))
    const id = db.listPiles()[0].id
    expect(await scanRow(id)).toMatchObject({ status: 'new', codeAssignment: 'W31', codeSetUp: false, arriving: false, pagesIn: 1 })
    // the W30 pile undone earlier names an assignment that exists
    const w30 = (await get('/api/scan')).body.piles.find((p: any) => p.codeAssignment === 'W30')
    expect(w30).toMatchObject({ status: 'new', codeSetUp: true })
  })

  it('settles a waiting pile when the assignment its codes name is created', async () => {
    const id = db.listPiles()[0].id
    const r = await post('/api/assignments', { code: 'W31', title: 'Rivers 2', klass: 'Rose', sheets: 1 })
    expect(r.status).toBe(200)
    expect(db.getPile(id)).toMatchObject({ status: 'done', assignment: 'W31' })
    expect(db.getPacket('S11', 'W31')).toMatchObject({ sides: 1 })
    // an edit of an assignment that already existed leaves an undone pile alone
    expect((await post('/api/assignments', { code: 'W30', title: 'Rivers', klass: 'Rose', sheets: 2 })).status).toBe(200)
    expect((await get('/api/scan')).body.piles.find((p: any) => p.codeAssignment === 'W30')).toMatchObject({ status: 'new' })
  })

  it('says a pile is still arriving, and how many of its pages are in', async () => {
    const rendered = await pipeline.processInboxFile(await pilePdf('arr.pdf', ['SWS1:S01:W14:1A', 'SWS1:S01:W14:2A', 'SWS1:S01:W14:2B', 'SWS1:S01:W14:1B']))
    await pipeline.processInboxFile(rendered[0])
    const id = db.listPiles()[0].id
    expect(await scanRow(id)).toMatchObject({ status: 'new', arriving: true, pagesIn: 1, pages: 4 })
    for (const f of rendered.slice(1)) await pipeline.processInboxFile(f)
    expect(await scanRow(id)).toMatchObject({ arriving: false })
  })
})
