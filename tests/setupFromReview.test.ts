import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sws-setup-'))
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
  db.upsertStudent({ code: 'S03', name: 'Jiwoo Kim', nameKo: null, klass: 'Daisy', grade: 3, homeroom: null })
})
afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }))

// A page in review whose code read cleanly but named an assignment that does not exist.
function waiting(student: string, assignment: string, page: number, side: 'a' | 'b') {
  const seq = db.nextSeq()
  const file = path.join(config.HOLDING_DIR, `${seq}-x.jpg`)
  fs.writeFileSync(file, 'jpg')
  return db.insertPage({
    status: 'review', student, assignment, page, side, scannedAt: new Date().toISOString(), seq, sourceName: 'x.jpg', filePath: pipeline.rel(file),
    thumbPath: null, width: 1, height: 1, decoded: `SWS1:${student}:${assignment}:${page}${side.toUpperCase()}`, reason: `Code names assignment ${assignment}, which has not been set up`, filedFrom: null,
  })
}

describe('setting an assignment up from the pages waiting for it', () => {
  it('reads class, grade, sheets and sides off the pages, creates it, and files them all', () => {
    waiting('S07', 'W14-1', 1, 'a')
    waiting('S07', 'W14-1', 2, 'b')
    waiting('S03', 'W14-1', 1, 'a')
    waiting('S03', 'W14-1', 1, 'a') // scanned twice: the later one takes the side
    const other = waiting('S03', 'W15', 1, 'a') // a different missing assignment stays put
    const r = pipeline.setupAssignmentFromReview('W14-1', { title: 'Country Report' })
    expect(r.assignment).toMatchObject({ code: 'W14-1', title: 'Country Report', klass: 'Daisy', grade: 3, sheets: 2, twoSided: 1, waiting: 0 })
    expect(r.filed).toBe(4)
    expect(r.failed).toEqual([])
    expect(db.reviewPages().map((p) => p.id)).toEqual([other.id])
    expect(db.getPacket('S07', 'W14-1')).toMatchObject({ sides: 2, expected: 4 })
    expect(db.packetPages('S03', 'W14-1')).toHaveLength(1)
  })
  it('names the assignment after its code when no title is given, and refuses one with nothing waiting', () => {
    expect(() => pipeline.setupAssignmentFromReview('W99', {})).toThrow(/no pages/)
    const r = pipeline.setupAssignmentFromReview('W15', {})
    expect(r.assignment.title).toBe('W15')
    expect(r.assignment.sheets).toBe(1)
    expect(r.assignment.twoSided).toBe(0)
  })
})
