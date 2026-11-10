import { DatabaseSync } from 'node:sqlite'
import fs from 'node:fs'
import path from 'node:path'
import { DB_PATH } from './config.js'
import type { Assignment, Packet, Page, Progress, Side, Student } from '../shared/types.js'
import type { Annotation, AnnotationKind } from '../shared/annotations.js'
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
  CREATE TABLE IF NOT EXISTS skills (
    student TEXT NOT NULL,
    assignment TEXT NOT NULL,
    name TEXT NOT NULL,
    level TEXT NOT NULL,
    evidence TEXT,
    at TEXT NOT NULL,
    PRIMARY KEY (student, assignment, name)
  );
  CREATE INDEX IF NOT EXISTS skills_student ON skills(student, at);
  CREATE TABLE IF NOT EXISTS domains (
    student TEXT NOT NULL,
    assignment TEXT NOT NULL,
    domain TEXT NOT NULL,
    level INTEGER NOT NULL,
    note TEXT,
    at TEXT NOT NULL,
    PRIMARY KEY (student, assignment, domain)
  );
  CREATE TABLE IF NOT EXISTS annotations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pageId INTEGER NOT NULL,
    x REAL NOT NULL,
    y REAL NOT NULL,
    w REAL NOT NULL,
    h REAL NOT NULL,
    kind TEXT NOT NULL,
    text TEXT NOT NULL,
    createdAt TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS annotations_page ON annotations(pageId, createdAt);
  `)
  // Columns added after the first release.
  const cols = (d.prepare('PRAGMA table_info(students)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!cols.includes('externalId')) d.exec('ALTER TABLE students ADD COLUMN externalId TEXT')
  const acols = (d.prepare('PRAGMA table_info(assignments)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!acols.includes('sides')) d.exec('ALTER TABLE assignments ADD COLUMN sides INTEGER')
  if (!acols.includes('analysis')) d.exec('ALTER TABLE assignments ADD COLUMN analysis TEXT')
  if (!acols.includes('rubric')) d.exec('ALTER TABLE assignments ADD COLUMN rubric TEXT')
  const pcols = (d.prepare('PRAGMA table_info(packets)').all() as Array<{ name: string }>).map((c) => c.name)
  if (!pcols.includes('feedback')) d.exec('ALTER TABLE packets ADD COLUMN feedback TEXT')
  if (!pcols.includes('analysedAt')) d.exec('ALTER TABLE packets ADD COLUMN analysedAt TEXT')
  if (!pcols.includes('corrections')) d.exec('ALTER TABLE packets ADD COLUMN corrections TEXT')
  if (!pcols.includes('criteria')) d.exec('ALTER TABLE packets ADD COLUMN criteria TEXT')
  if (!pcols.includes('progress')) d.exec('ALTER TABLE packets ADD COLUMN progress TEXT')
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
export function upsertAssignment(a: Omit<Assignment, 'createdAt' | 'sides' | 'analysis' | 'rubric'> & { sides?: number | null }) {
  getDb()
    .prepare(
      `INSERT INTO assignments (code,title,klass,grade,assignedOn,sheets,twoSided,tags,notes,sides) VALUES (?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(code) DO UPDATE SET title=excluded.title, klass=excluded.klass, grade=excluded.grade,
       assignedOn=excluded.assignedOn, sheets=excluded.sheets, twoSided=excluded.twoSided, tags=excluded.tags, notes=excluded.notes, sides=excluded.sides`,
    )
    .run(a.code, a.title, a.klass, a.grade ?? null, a.assignedOn ?? null, a.sheets, a.twoSided, a.tags ?? '', a.notes ?? null, a.sides ?? null)
}
export function setAssignmentRubric(code: string, rubric: string | null) {
  getDb().prepare('UPDATE assignments SET rubric = ? WHERE code = ?').run(rubric, code)
}
export function setPacketCriteria(student: string, assignment: string, criteria: Array<{ criterion: string; met: boolean; evidence: string | null }> | null) {
  getDb().prepare('UPDATE packets SET criteria = ? WHERE student = ? AND assignment = ?').run(criteria && criteria.length ? JSON.stringify(criteria) : null, student, assignment)
}
export function setPacketProgress(student: string, assignment: string, progress: Progress | null) {
  getDb().prepare('UPDATE packets SET progress = ? WHERE student = ? AND assignment = ?').run(progress && (progress.items.length || progress.followedUp) ? JSON.stringify(progress) : null, student, assignment)
}
export function setAssignmentAnalysis(code: string, analysis: string | null) {
  getDb().prepare('UPDATE assignments SET analysis = ? WHERE code = ?').run(analysis, code)
}
/** Every packet of an assignment recounted, after its sheets or sides change. */
export function refreshPacketsFor(assignment: string) {
  for (const p of packetsForAssignment(assignment)) refreshPacket(p.student, p.assignment, p.lastAt)
}
export function deletePacket(student: string, assignment: string) {
  getDb().prepare('DELETE FROM packets WHERE student = ? AND assignment = ?').run(student, assignment)
}
/** Remove an assignment that has no work filed under it. Returns false when pages or packets exist. */
export function deleteAssignment(code: string): boolean {
  const d = getDb()
  const used = d.prepare("SELECT 1 FROM pages WHERE assignment = ? AND status IN ('filed','review') LIMIT 1").get(code) || d.prepare('SELECT 1 FROM packets WHERE assignment = ? LIMIT 1').get(code)
  if (used) return false
  d.prepare('DELETE FROM assignments WHERE code = ?').run(code)
  return true
}
// Every side the assignment expects. `sides` caps it for a double-sided
// packet with an odd page count, whose last back is blank and never scanned.
export function sidesFor(a: Assignment): Array<{ page: number; side: Side }> {
  const all = expectedSides(a.sheets, !!a.twoSided)
  return a.sides && a.sides > 0 && a.sides < all.length ? all.slice(0, a.sides) : all
}
export function expectedFor(a: Assignment): number {
  return sidesFor(a).length
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
export function setPacketCorrections(student: string, assignment: string, corrections: Array<{ wrote: string; better: string; why: string | null }> | null) {
  getDb().prepare('UPDATE packets SET corrections = ? WHERE student = ? AND assignment = ?').run(corrections && corrections.length ? JSON.stringify(corrections) : null, student, assignment)
}
export function setPacketFeedback(student: string, assignment: string, feedback: string | null) {
  getDb().prepare('UPDATE packets SET feedback = ? WHERE student = ? AND assignment = ?').run(feedback, student, assignment)
}

export function markAnalysed(student: string, assignment: string) {
  getDb().prepare('UPDATE packets SET analysedAt = ? WHERE student = ? AND assignment = ?').run(new Date().toISOString(), student, assignment)
}

// ---------- skills ----------
export interface SkillRow { student: string; assignment: string; name: string; level: 'secure' | 'developing' | 'not_yet'; evidence: string | null; at: string }
export function replaceSkills(student: string, assignment: string, skills: Array<{ name: string; level: SkillRow['level']; evidence: string; at: string }>) {
  const d = getDb()
  d.prepare('DELETE FROM skills WHERE student = ? AND assignment = ?').run(student, assignment)
  const ins = d.prepare('INSERT OR REPLACE INTO skills (student, assignment, name, level, evidence, at) VALUES (?,?,?,?,?,?)')
  for (const k of skills) ins.run(student, assignment, k.name.trim().toLowerCase(), k.level, k.evidence, k.at)
}
export function allSkills(): SkillRow[] {
  return getDb().prepare('SELECT * FROM skills ORDER BY student, assignment, name').all() as unknown as SkillRow[]
}
/** Replaces the whole skills table, in one transaction. Used when the vocabulary changes. */
export function writeSkillRows(rows: SkillRow[]) {
  const d = getDb()
  const ins = d.prepare('INSERT OR REPLACE INTO skills (student, assignment, name, level, evidence, at) VALUES (?,?,?,?,?,?)')
  d.exec('BEGIN')
  try {
    d.exec('DELETE FROM skills')
    for (const r of rows) ins.run(r.student, r.assignment, r.name, r.level, r.evidence, r.at)
    d.exec('COMMIT')
  } catch (err) {
    d.exec('ROLLBACK')
    throw err
  }
}
export function skillsForStudent(student: string): SkillRow[] {
  return getDb().prepare('SELECT * FROM skills WHERE student = ? ORDER BY at, name').all(student) as unknown as SkillRow[]
}
export function skillsForAssignment(assignment: string): SkillRow[] {
  return getDb().prepare('SELECT * FROM skills WHERE assignment = ? ORDER BY student, name').all(assignment) as unknown as SkillRow[]
}

// ---------- domains: the rubric-like ratings, 1 to 4, per student per assignment ----------
export interface DomainRow { student: string; assignment: string; domain: string; level: number; note: string | null; at: string }
export function replaceDomains(student: string, assignment: string, rows: Array<{ domain: string; level: number; note: string | null }>, at: string) {
  const d = getDb()
  d.prepare('DELETE FROM domains WHERE student = ? AND assignment = ?').run(student, assignment)
  const ins = d.prepare('INSERT OR REPLACE INTO domains (student, assignment, domain, level, note, at) VALUES (?,?,?,?,?,?)')
  for (const r of rows) ins.run(student, assignment, r.domain, Math.max(1, Math.min(4, Math.round(r.level))), r.note, at)
}
export function domainsForAssignment(assignment: string): DomainRow[] {
  return getDb().prepare('SELECT * FROM domains WHERE assignment = ? ORDER BY student, domain').all(assignment) as unknown as DomainRow[]
}
export function domainsForStudent(student: string): DomainRow[] {
  return getDb().prepare('SELECT * FROM domains WHERE student = ? ORDER BY at, domain').all(student) as unknown as DomainRow[]
}

// ---------- annotations: the teacher's comments pinned to a spot on a page ----------
export function annotationsForPage(pageId: number): Annotation[] {
  return getDb().prepare('SELECT * FROM annotations WHERE pageId = ? ORDER BY createdAt, id').all(pageId) as unknown as Annotation[]
}
export function annotationsForPages(pageIds: number[]): Annotation[] {
  if (!pageIds.length) return []
  return getDb().prepare(`SELECT * FROM annotations WHERE pageId IN (${pageIds.map(() => '?').join(',')}) ORDER BY pageId, createdAt, id`).all(...pageIds) as unknown as Annotation[]
}
/** How many comments each of these pages carries; pages with none are left out. */
export function annotationCounts(pageIds: number[]): Map<number, number> {
  const out = new Map<number, number>()
  if (!pageIds.length) return out
  const rows = getDb().prepare(`SELECT pageId, COUNT(*) AS n FROM annotations WHERE pageId IN (${pageIds.map(() => '?').join(',')}) GROUP BY pageId`).all(...pageIds) as Array<{ pageId: number; n: number }>
  for (const r of rows) out.set(r.pageId, r.n)
  return out
}
export function getAnnotation(id: number): Annotation | undefined {
  return getDb().prepare('SELECT * FROM annotations WHERE id = ?').get(id) as unknown as Annotation | undefined
}
export function insertAnnotation(a: { pageId: number; x: number; y: number; w: number; h: number; kind: AnnotationKind; text: string }): Annotation {
  const r = getDb().prepare('INSERT INTO annotations (pageId, x, y, w, h, kind, text, createdAt) VALUES (?,?,?,?,?,?,?,?)').run(a.pageId, a.x, a.y, a.w, a.h, a.kind, a.text, new Date().toISOString())
  return getAnnotation(Number(r.lastInsertRowid))!
}
export function updateAnnotation(id: number, patch: Partial<Pick<Annotation, 'x' | 'y' | 'w' | 'h' | 'kind' | 'text'>>): Annotation | undefined {
  const a = getAnnotation(id)
  if (!a) return undefined
  const n = { ...a, ...patch }
  getDb().prepare('UPDATE annotations SET x = ?, y = ?, w = ?, h = ?, kind = ?, text = ? WHERE id = ?').run(n.x, n.y, n.w, n.h, n.kind, n.text, id)
  return getAnnotation(id)
}
export function deleteAnnotation(id: number): boolean {
  return getDb().prepare('DELETE FROM annotations WHERE id = ?').run(id).changes > 0
}
/** Pages with their comment counts attached, for lists that show a badge. */
export function withAnnotationCounts<T extends { id: number }>(pages: T[]): Array<T & { annotations: number }> {
  const counts = annotationCounts(pages.map((p) => p.id))
  return pages.map((p) => ({ ...p, annotations: counts.get(p.id) ?? 0 }))
}

// ---------- meta ----------
export function getMeta(key: string): string | null {
  const r = getDb().prepare('SELECT value FROM meta WHERE key = ?').get(key) as { value: string } | undefined
  return r?.value ?? null
}
export function metaWithPrefix(prefix: string): Array<{ key: string; value: string }> {
  return getDb().prepare("SELECT key, value FROM meta WHERE key LIKE ? ESCAPE '\\'").all(`${prefix.replace(/[%_\\]/g, '\\$&')}%`) as Array<{ key: string; value: string }>
}
export function setMeta(key: string, value: string) {
  getDb().prepare('INSERT INTO meta (key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, value)
}
