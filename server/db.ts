import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { DB_PATH } from './config.js'
import type { Assignment, Packet, Page, Side, Student } from '../shared/types.js'
import { expectedSides } from './codes.js'

let db: DatabaseSync

export function openDb(file = DB_PATH): DatabaseSync {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec('PRAGMA foreign_keys = ON')
  migrate(db)
  return db
}

export function getDb(): DatabaseSync {
  if (!db) throw new Error('database not open')
  return db
}

function migrate(d: DatabaseSync) {
  d.exec(`
  CREATE TABLE IF NOT EXISTS students (
    code TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    nameKo TEXT,
    klass TEXT NOT NULL,
    grade INTEGER,
    homeroom TEXT,
    active INTEGER NOT NULL DEFAULT 1
  );
  CREATE TABLE IF NOT EXISTS assignments (
    code TEXT PRIMARY KEY,
    title TEXT NOT NULL,
    klass TEXT NOT NULL,
    grade INTEGER,
    assignedOn TEXT,
    sheets INTEGER NOT NULL DEFAULT 1,
    twoSided INTEGER NOT NULL DEFAULT 1,
    tags TEXT NOT NULL DEFAULT '',
    notes TEXT,
    createdAt TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE TABLE IF NOT EXISTS pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    status TEXT NOT NULL,
    student TEXT,
    assignment TEXT,
    page INTEGER,
    side TEXT,
    scannedAt TEXT NOT NULL,
    seq INTEGER NOT NULL,
    sourceName TEXT NOT NULL,
    filePath TEXT NOT NULL,
    thumbPath TEXT,
    width INTEGER,
    height INTEGER,
    decoded TEXT,
    reason TEXT,
    filedFrom TEXT
  );
  CREATE INDEX IF NOT EXISTS pages_packet ON pages(assignment, student, status);
  CREATE INDEX IF NOT EXISTS pages_seq ON pages(seq);
  CREATE TABLE IF NOT EXISTS packets (
    student TEXT NOT NULL,
    assignment TEXT NOT NULL,
    sides INTEGER NOT NULL DEFAULT 0,
    expected INTEGER NOT NULL,
    complete INTEGER NOT NULL DEFAULT 0,
    closedIncomplete INTEGER NOT NULL DEFAULT 0,
    firstAt TEXT NOT NULL,
    lastAt TEXT NOT NULL,
    score REAL,
    scoreOf REAL,
    note TEXT,
    PRIMARY KEY (student, assignment)
  );
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
  `)
  // Columns added after the first release.
  const cols = (d.prepare('PRAGMA table_info(students)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('externalId')) d.exec('ALTER TABLE students ADD COLUMN externalId TEXT')
}

// ---------- students ----------
export function listStudents(klass?: string): Student[] {
  const d = getDb()
  if (klass) return d.prepare('SELECT * FROM students WHERE klass = ? ORDER BY grade, name').all(klass) as unknown as Student[]
  return d.prepare('SELECT * FROM students ORDER BY klass, grade, name').all() as unknown as Student[]
}
export function getStudent(code: string): Student | undefined {
  return getDb().prepare('SELECT * FROM students WHERE code = ?').get(code) as unknown as Student | undefined
}
export function upsertStudent(s: Omit<Student, 'active' | 'externalId'> & { active?: number; externalId?: string | null }) {
  getDb()
    .prepare(
      `INSERT INTO students (code,name,nameKo,klass,grade,homeroom,active,externalId) VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(code) DO UPDATE SET name=excluded.name, nameKo=excluded.nameKo, klass=excluded.klass,
       grade=excluded.grade, homeroom=excluded.homeroom, active=excluded.active, externalId=COALESCE(excluded.externalId, students.externalId)`,
    )
    .run(s.code, s.name, s.nameKo ?? null, s.klass, s.grade ?? null, s.homeroom ?? null, s.active ?? 1, s.externalId ?? null)
}
export function findStudentsByName(q: string): Student[] {
  const like = `%${q.trim()}%`
  return getDb()
    .prepare('SELECT * FROM students WHERE name LIKE ? OR nameKo LIKE ? OR code LIKE ? ORDER BY name LIMIT 20')
    .all(like, like, like) as unknown as Student[]
}

// ---------- assignments ----------
export function listAssignments(): Assignment[] {
  return getDb().prepare('SELECT * FROM assignments ORDER BY COALESCE(assignedOn, createdAt) DESC, code DESC').all() as unknown as Assignment[]
}
export function getAssignment(code: string): Assignment | undefined {
  return getDb().prepare('SELECT * FROM assignments WHERE code = ?').get(code) as unknown as Assignment | undefined
}
export function upsertAssignment(a: Omit<Assignment, 'createdAt'>) {
  getDb()
    .prepare(
      `INSERT INTO assignments (code,title,klass,grade,assignedOn,sheets,twoSided,tags,notes) VALUES (?,?,?,?,?,?,?,?,?)
       ON CONFLICT(code) DO UPDATE SET title=excluded.title, klass=excluded.klass, grade=excluded.grade,
       assignedOn=excluded.assignedOn, sheets=excluded.sheets, twoSided=excluded.twoSided, tags=excluded.tags, notes=excluded.notes`,
    )
    .run(a.code, a.title, a.klass, a.grade ?? null, a.assignedOn ?? null, a.sheets, a.twoSided, a.tags ?? '', a.notes ?? null)
}
export function expectedFor(a: Assignment): number {
  return expectedSides(a.sheets, !!a.twoSided).length
}

// ---------- pages ----------
export function nextSeq(): number {
  const row = getDb().prepare('SELECT COALESCE(MAX(seq),0) AS m FROM pages').get() as { m: number }
  return row.m + 1
}
export function insertPage(p: Omit<Page, 'id'>): Page {
  const r = getDb()
    .prepare(
      `INSERT INTO pages (status,student,assignment,page,side,scannedAt,seq,sourceName,filePath,thumbPath,width,height,decoded,reason,filedFrom)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    )
    .run(
      p.status, p.student, p.assignment, p.page, p.side, p.scannedAt, p.seq, p.sourceName, p.filePath,
      p.thumbPath, p.width, p.height, p.decoded, p.reason, p.filedFrom,
    )
  return { ...p, id: Number(r.lastInsertRowid) }
}
export function updatePage(id: number, patch: Partial<Page>) {
  const keys = Object.keys(patch) as Array<keyof Page>
  if (!keys.length) return
  const sets = keys.map((k) => `${k} = ?`).join(', ')
  getDb().prepare(`UPDATE pages SET ${sets} WHERE id = ?`).run(...keys.map((k) => (patch as any)[k]), id)
}
export function getPage(id: number): Page | undefined {
  return getDb().prepare('SELECT * FROM pages WHERE id = ?').get(id) as unknown as Page | undefined
}
export function recentPages(limit = 40): Page[] {
  return getDb().prepare('SELECT * FROM pages ORDER BY seq DESC LIMIT ?').all(limit) as unknown as Page[]
}
export function pagesSince(iso: string): Page[] {
  return getDb().prepare('SELECT * FROM pages WHERE scannedAt >= ? ORDER BY seq DESC').all(iso) as unknown as Page[]
}
export function neighbourPages(seq: number, span = 3): Page[] {
  return getDb()
    .prepare('SELECT * FROM pages WHERE seq BETWEEN ? AND ? AND seq != ? ORDER BY seq')
    .all(seq - span, seq + span, seq) as unknown as Page[]
}
export function packetPages(student: string, assignment: string): Page[] {
  return getDb()
    .prepare("SELECT * FROM pages WHERE student = ? AND assignment = ? AND status = 'filed' ORDER BY page, side")
    .all(student, assignment) as unknown as Page[]
}
export function pagesForStudent(student: string): Page[] {
  return getDb().prepare("SELECT * FROM pages WHERE student = ? AND status = 'filed' ORDER BY scannedAt DESC").all(student) as unknown as Page[]
}
export function pagesForAssignment(assignment: string): Page[] {
  return getDb().prepare("SELECT * FROM pages WHERE assignment = ? AND status = 'filed' ORDER BY student, page, side").all(assignment) as unknown as Page[]
}
export function reviewPages(): Page[] {
  return getDb().prepare("SELECT * FROM pages WHERE status = 'review' ORDER BY seq").all() as unknown as Page[]
}
export function hasSide(student: string, assignment: string, page: number, side: Side): boolean {
  const r = getDb()
    .prepare("SELECT 1 FROM pages WHERE student=? AND assignment=? AND page=? AND side=? AND status='filed' LIMIT 1")
    .get(student, assignment, page, side)
  return !!r
}

// ---------- packets ----------
export function getPacket(student: string, assignment: string): Packet | undefined {
  return getDb().prepare('SELECT * FROM packets WHERE student = ? AND assignment = ?').get(student, assignment) as unknown as Packet | undefined
}
export function packetsForAssignment(assignment: string): Packet[] {
  return getDb().prepare('SELECT * FROM packets WHERE assignment = ? ORDER BY student').all(assignment) as unknown as Packet[]
}
export function packetsForStudent(student: string): Packet[] {
  return getDb().prepare('SELECT * FROM packets WHERE student = ? ORDER BY lastAt DESC').all(student) as unknown as Packet[]
}
export function allPackets(): Packet[] {
  return getDb().prepare('SELECT * FROM packets ORDER BY lastAt DESC').all() as unknown as Packet[]
}
export function openPackets(): Packet[] {
  return getDb().prepare('SELECT * FROM packets WHERE complete = 0 ORDER BY lastAt').all() as unknown as Packet[]
}

// Recount a packet from its filed pages and return it. Creates it if needed.
export function refreshPacket(student: string, assignment: string, at: string): Packet {
  const d = getDb()
  const a = getAssignment(assignment)
  const expected = a ? expectedFor(a) : 1
  const pages = packetPages(student, assignment)
  const sides = new Set(pages.map((p) => `${p.page}${p.side}`)).size
  const existing = getPacket(student, assignment)
  const firstAt = existing?.firstAt ?? pages[0]?.scannedAt ?? at
  const lastAt = pages.reduce((m, p) => (p.scannedAt > m ? p.scannedAt : m), existing?.lastAt ?? at)
  const closed = existing?.closedIncomplete ?? 0
  const complete = sides >= expected || closed ? 1 : 0
  d.prepare(
    `INSERT INTO packets (student,assignment,sides,expected,complete,closedIncomplete,firstAt,lastAt)
     VALUES (?,?,?,?,?,?,?,?)
     ON CONFLICT(student,assignment) DO UPDATE SET sides=excluded.sides, expected=excluded.expected,
     complete=excluded.complete, lastAt=excluded.lastAt`,
  ).run(student, assignment, sides, expected, complete, closed, firstAt, lastAt)
  return getPacket(student, assignment)!
}
export function closePacketIncomplete(student: string, assignment: string) {
  getDb().prepare('UPDATE packets SET closedIncomplete = 1, complete = 1 WHERE student = ? AND assignment = ?').run(student, assignment)
}
export function setPacketScore(student: string, assignment: string, score: number | null, scoreOf: number | null, note: string | null) {
  getDb().prepare('UPDATE packets SET score = ?, scoreOf = ?, note = ? WHERE student = ? AND assignment = ?').run(score, scoreOf, note, student, assignment)
}

// ---------- meta ----------
export function getMeta(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}
export function setMeta(key: string, value: string) {
  getDb().prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
}
