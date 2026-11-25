import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import QRCode from 'qrcode'
import sharp from 'sharp'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sws-rescan-'))
process.env.SWS_DATA_DIR = tmp

let pipeline: typeof import('../server/pipeline.js')
let db: typeof import('../server/db.js')
let config: typeof import('../server/config.js')

beforeAll(async () => {
  config = await import('../server/config.js')
  db = await import('../server/db.js')
  pipeline = await import('../server/pipeline.js')
  config.ensureDirs()
  db.openDb(':memory:')
  db.upsertStudent({ code: 'S07', name: 'Minji Park', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
  db.upsertAssignment({ code: 'W22', title: 'Weekend Writing', klass: 'Daisy', grade: 3, assignedOn: null, sheets: 1, twoSided: 0, tags: '', notes: null })
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

// A page with the code in its top right corner, as the labels print it.
async function codedPage(name: string, code: string, shade: string) {
  const qr = await QRCode.toBuffer(code, { type: 'png', margin: 2, errorCorrectionLevel: 'H', width: 180 })
  const file = path.join(config.INBOX_DIR, name)
  await sharp({ create: { width: 800, height: 1100, channels: 3, background: shade } }).composite([{ input: qr, top: 40, left: 580 }]).jpeg().toFile(file)
  return file
}

describe('scanning a filed side again', () => {
  it('replaces the earlier scan on its own, and keeps the comments on it', async () => {
    const first = await pipeline.processImage(await codedPage('a.jpg', 'SWS1:S07:W22:1A', '#ffffff'), 'a.jpg')
    expect(first.status).toBe('filed')
    db.insertAnnotation({ pageId: first.id, x: 0.1, y: 0.1, w: 0.2, h: 0.1, kind: 'praise', text: 'lovely' })

    const again = await pipeline.processImage(await codedPage('b.jpg', 'SWS1:S07:W22:1A', '#eeeeee'), 'b.jpg')
    expect(again.status).toBe('filed')
    expect(again.filePath).toBe(first.filePath)
    expect(db.getPage(first.id)).toMatchObject({ status: 'replaced', reason: `replaced by rescan, page ${again.id}` })
    expect(db.packetPages('S07', 'W22').map((p) => p.id)).toEqual([again.id])
    expect(db.getPacket('S07', 'W22')).toMatchObject({ sides: 1, complete: 1 })
    expect(db.annotationsForPage(again.id).map((a) => a.text)).toEqual(['lovely'])
    expect(db.annotationsForPage(first.id)).toEqual([])
    expect(db.reviewPages()).toEqual([])
    // the newer scan is the one on disk
    const meta = await sharp(path.join(tmp, again.filePath)).stats()
    expect(meta.channels[0].mean).toBeLessThan(250)
  })
  it('a rescan of a side that was removed from disk still files cleanly', async () => {
    const p = db.packetPages('S07', 'W22')[0]
    fs.rmSync(path.join(tmp, p.filePath))
    const again = await pipeline.processImage(await codedPage('c.jpg', 'SWS1:S07:W22:1A', '#ffffff'), 'c.jpg')
    expect(again.status).toBe('filed')
    expect(fs.existsSync(path.join(tmp, again.filePath))).toBe(true)
    expect(db.packetPages('S07', 'W22')).toHaveLength(1)
  })
  it('keeps the replaced file beside the new one, and can restore it', async () => {
    const first = await pipeline.processImage(await codedPage('d.jpg', 'SWS1:S07:W22:1A', '#ffffff'), 'd.jpg')
    const again = await pipeline.processImage(await codedPage('e.jpg', 'SWS1:S07:W22:1A', '#dddddd'), 'e.jpg')
    const old = db.getPage(first.id)!
    expect(old.filePath).toBe(pipeline.rel(pipeline.replacedPath(path.join(tmp, again.filePath), first.id)))
    expect(fs.existsSync(path.join(tmp, old.filePath))).toBe(true)
    const restored = pipeline.restoreReplaced(first.id)
    expect(restored).toMatchObject({ id: first.id, status: 'filed', filePath: again.filePath })
    expect(db.getPage(again.id)!.status).toBe('review')
    expect(db.packetPages('S07', 'W22').map((p) => p.id)).toEqual([first.id])
  })
  it('refuses to restore a scan whose old file was already gone, changing nothing', async () => {
    const first = await pipeline.processImage(await codedPage('f.jpg', 'SWS1:S07:W22:1A', '#ffffff'), 'f.jpg')
    fs.rmSync(path.join(tmp, first.filePath))
    const again = await pipeline.processImage(await codedPage('g.jpg', 'SWS1:S07:W22:1A', '#dddddd'), 'g.jpg')
    db.insertAnnotation({ pageId: again.id, x: 0.1, y: 0.1, w: 0.2, h: 0.1, kind: 'praise', text: 'kept here' })
    expect(() => pipeline.restoreReplaced(first.id)).toThrow()
    expect(db.getPage(again.id)).toMatchObject({ status: 'filed', filePath: again.filePath })
    expect(db.getPage(first.id)!.status).toBe('replaced')
    expect(fs.existsSync(path.join(tmp, again.filePath))).toBe(true)
    expect(db.annotationsForPage(again.id).map((a) => a.text)).toContain('kept here')
  })
  it('refuses to restore a scan whose replacer was itself replaced', async () => {
    const a = await pipeline.processImage(await codedPage('h.jpg', 'SWS1:S07:W22:1A', '#ffffff'), 'h.jpg')
    const b = await pipeline.processImage(await codedPage('i.jpg', 'SWS1:S07:W22:1A', '#eeeeee'), 'i.jpg')
    const c = await pipeline.processImage(await codedPage('j.jpg', 'SWS1:S07:W22:1A', '#dddddd'), 'j.jpg')
    expect(() => pipeline.restoreReplaced(a.id)).toThrow()
    expect(db.getPage(c.id)).toMatchObject({ status: 'filed', filePath: c.filePath })
    expect(db.getPage(b.id)!.status).toBe('replaced')
    expect(fs.existsSync(path.join(tmp, c.filePath))).toBe(true)
    expect(fs.existsSync(path.join(tmp, db.getPage(b.id)!.filePath))).toBe(true)
  })
  it('restores a scan whose replacer\'s file is gone, and the replacer no longer points at the restored file', async () => {
    const first = await pipeline.processImage(await codedPage('k.jpg', 'SWS1:S07:W22:1A', '#ffffff'), 'k.jpg')
    const again = await pipeline.processImage(await codedPage('l.jpg', 'SWS1:S07:W22:1A', '#dddddd'), 'l.jpg')
    fs.rmSync(path.join(tmp, again.filePath)) // the live file is missing
    const restored = pipeline.restoreReplaced(first.id)
    expect(restored.filePath).toBe(again.filePath)
    const by = db.getPage(again.id)!
    expect(by.status).toBe('review')
    expect(by.filePath).not.toBe(restored.filePath)
    expect(by.filePath.startsWith('holding/')).toBe(true)
  })
})
