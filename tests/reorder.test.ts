import { beforeEach, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
// The pipeline writes under DATA_DIR, which config reads from the environment
// when it is first imported, so the environment is set before any import of
// the server happens (static imports would run first).
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sws-'))
process.env.SWS_DATA_DIR = tmp
const { getPacket, insertPage, nextSeq, openDb, packetPages, refreshPacket, upsertAssignment, upsertStudent } = await import('../server/db.js')
const { reorderPacket, unfilePage } = await import('../server/pipeline.js')
const { ARCHIVE_DIR, HOLDING_DIR, ensureDirs } = await import('../server/config.js')

function filedWithFile(student: string, assignment: string, page: number, side: 'a' | 'b'): number {
  const dir = path.join(ARCHIVE_DIR, assignment, student)
  fs.mkdirSync(dir, { recursive: true })
  const file = path.join(dir, `${page}${side}.jpg`)
  fs.writeFileSync(file, `${page}${side}`)
  const seq = nextSeq()
  const p = insertPage({
    status: 'filed', student, assignment, page, side, scannedAt: '2026-11-09T01:00:00.000Z', seq, sourceName: `s${seq}.jpg`,
    filePath: path.relative(tmp, file).split(path.sep).join('/'), thumbPath: null, width: 1, height: 1, decoded: null, reason: null, filedFrom: 'code',
  })
  refreshPacket(student, assignment, '2026-11-09T01:00:00.000Z')
  return p.id
}

beforeEach(() => {
  // never clear anything outside the temp dir, whatever the environment says
  if (!ARCHIVE_DIR.startsWith(tmp) || !HOLDING_DIR.startsWith(tmp)) throw new Error(`test data dir is not the temp dir: ${ARCHIVE_DIR}`)
  ensureDirs()
  fs.rmSync(ARCHIVE_DIR, { recursive: true, force: true })
  fs.rmSync(HOLDING_DIR, { recursive: true, force: true })
  ensureDirs()
  openDb(':memory:')
  upsertStudent({ code: '4S18', name: 'Lee Yoona', nameKo: null, klass: 'Snapdragon', grade: 4, homeroom: null })
  upsertAssignment({ code: 'W04', title: 'Now vs. In 20 Years', klass: 'Snapdragon', grade: 4, assignedOn: null, sheets: 2, twoSided: 1, tags: '', notes: null, sides: 3 })
})

describe('reordering a packet', () => {
  it('renumbers sides by position and moves the files to match', () => {
    const a = filedWithFile('4S18', 'W04', 1, 'a') // really the back of sheet 1
    const b = filedWithFile('4S18', 'W04', 1, 'b') // really sheet 2 front
    const c = filedWithFile('4S18', 'W04', 2, 'a') // really sheet 1 front
    const pages = reorderPacket('4S18', 'W04', [c, a, b])
    expect(pages.map((p) => `${p.id}:${p.page}${p.side}`)).toEqual([`${c}:1a`, `${a}:1b`, `${b}:2a`])
    // the file that was 2a.jpg now sits at 1a.jpg, and its content came with it
    expect(fs.readFileSync(path.join(ARCHIVE_DIR, 'W04', '4S18', '1a.jpg'), 'utf8')).toBe('2a')
    expect(fs.readFileSync(path.join(ARCHIVE_DIR, 'W04', '4S18', '1b.jpg'), 'utf8')).toBe('1a')
    expect(fs.readFileSync(path.join(ARCHIVE_DIR, 'W04', '4S18', '2a.jpg'), 'utf8')).toBe('1b')
    expect(getPacket('4S18', 'W04')).toMatchObject({ sides: 3, expected: 3, complete: 1 })
  })
  it('refuses an order that does not name every page once', () => {
    const a = filedWithFile('4S18', 'W04', 1, 'a')
    filedWithFile('4S18', 'W04', 1, 'b')
    expect(() => reorderPacket('4S18', 'W04', [a])).toThrow(/every page/)
  })
})

describe('sending a page back to review', () => {
  it('moves the file to holding, clears its filing, and recounts the packet', () => {
    const a = filedWithFile('4S18', 'W04', 1, 'a')
    filedWithFile('4S18', 'W04', 1, 'b')
    const p = unfilePage(a)
    expect(p.status).toBe('review')
    expect(p.student).toBeNull()
    expect(p.reason).toMatch(/Sent back from 4S18/)
    expect(fs.existsSync(path.join(HOLDING_DIR, path.basename(p.filePath)))).toBe(true)
    expect(packetPages('4S18', 'W04')).toHaveLength(1)
    expect(getPacket('4S18', 'W04')).toMatchObject({ sides: 1, complete: 0 })
  })
  it('removes the packet when its last page leaves', () => {
    const a = filedWithFile('4S18', 'W04', 1, 'a')
    unfilePage(a)
    expect(getPacket('4S18', 'W04')).toBeUndefined()
  })
})
