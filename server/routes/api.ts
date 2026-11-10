import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import {
  allPackets, expectedFor, findStudentsByName, getAssignment, getPacket, getStudent, listAssignments, listStudents,
  packetPages, packetsForAssignment, packetsForStudent, pagesForStudent, pagesSince, recentPages, reviewPages,
  setPacketScore, upsertAssignment, upsertStudent, closePacketIncomplete, getPage, getMeta, metaWithPrefix, sidesFor, deleteAssignment,
  refreshPacketsFor, setAssignmentAnalysis, setPacketFeedback,
} from '../db.js'
import { subscribe } from '../events.js'
import { guessesFor } from '../guesses.js'
import { abs, fileFromReview, reorderPacket, skipAllInReview, skipFromReview, stalePackets, unfilePage } from '../pipeline.js'
import { buildPdf } from '../pdf.js'
import { classPrompt, splitClassAnswer, splitStudentSection } from '../analysis.js'
import { enqueueAssignment, enqueueClass, enqueuePacket, getSettings, queueStatus, saveSettings, testKey, domainList, domainsFor, LEVELS } from '../claude.js'
import { skillsForStudent, skillsForAssignment, domainsForAssignment, domainsForStudent, replaceDomains, replaceSkills, setPacketCorrections, setPacketCriteria, setPacketProgress, setAssignmentRubric } from '../db.js'
import { canonicalSkill, skillVocabulary } from '../skills.js'
import { historyText, latestLevels, studentHistory } from '../history.js'
import { skillGroups } from '../../shared/skills.js'
import { parseCorrectionLines, parseCorrections, parseCriteria, parseProgress, parseRubric, progressDirection, DEFAULT_RUBRIC, SKILL_LEVEL_LABEL, type Rubric } from '../../shared/types.js'
import { watcherStatus } from '../watcher.js'
import { formatCode, sideLabel } from '../codes.js'
import type { Assignment, ReviewItem, Side, Student } from '../../shared/types.js'

export const api = Router()

api.get('/events', (req, res) => subscribe(res))

let build = 'dev'
export function setBuild(b: string) { build = b }
api.get('/status', (_req, res) => {
  res.json({ ...watcherStatus(), lastSeen: watcherStatus().lastSeen ?? getMeta('lastSeen'), build })
})

// ---------- Today ----------
api.get('/today', (_req, res) => {
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const weekAgo = new Date(Date.now() - 7 * 86400_000)
  const today = pagesSince(startOfDay.toISOString())
  const week = pagesSince(weekAgo.toISOString())
  const packets = allPackets()
  const todayKeys = new Set(today.filter((p) => p.student).map((p) => `${p.student}|${p.assignment}`))
  const weekKeys = new Set(week.filter((p) => p.student).map((p) => `${p.student}|${p.assignment}`))
  const filedToday = packets.filter((p) => p.complete && todayKeys.has(`${p.student}|${p.assignment}`)).length
  const filedWeek = packets.filter((p) => p.complete && weekKeys.has(`${p.student}|${p.assignment}`)).length
  const open = packets.filter((p) => !p.complete)
  const oldestOpen = open.length ? Math.min(...open.map((p) => Date.parse(p.lastAt))) : null
  const review = reviewCount()
  const students = new Map(listStudents().map((s) => [s.code, s]))
  const feed = recentPages(60).map((p) => decorate(p, students))
  res.json({
    feed,
    stats: {
      pagesToday: today.length,
      packetsFiledToday: filedToday,
      inReview: review,
      incomplete: open.length,
      oldestIncompleteMin: oldestOpen ? Math.round((Date.now() - oldestOpen) / 60000) : null,
      pagesWeek: week.length,
      packetsWeek: filedWeek,
    },
    outstanding: outstanding(),
    noticing: latestNoticing(),
    analysisOn: getSettings().hasKey,
  })
})

// The newest "worth noticing" line the class analysis wrote, with its assignment.
function latestNoticing(): { text: string; at: string; assignment: string } | null {
  let best: { text: string; at: string; assignment: string } | null = null
  for (const row of metaWithPrefix('noticing:')) {
    try {
      const v = JSON.parse(row.value) as { text: string; at: string }
      if (!best || v.at > best.at) best = { ...v, assignment: row.key.slice('noticing:'.length) }
    } catch { /* an old value */ }
  }
  return best
}

function reviewCount() {
  return reviewPages().length + stalePackets().length
}

function decorate(p: ReturnType<typeof recentPages>[number], students: Map<string, Student>) {
  const s = p.student ? students.get(p.student) : undefined
  const packet = p.student && p.assignment ? getPacket(p.student, p.assignment) : undefined
  return { ...p, studentName: s?.name ?? null, packet: packet ?? null }
}

// Assignments with students who have not turned anything in yet, newest first.
function outstanding() {
  const out: Array<{ assignment: Assignment; missing: Student[]; total: number }> = []
  for (const a of listAssignments().slice(0, 6)) {
    const roster = listStudents(a.klass).filter((s) => s.active && (a.grade == null || s.grade == null || s.grade === a.grade))
    const have = new Set(packetsForAssignment(a.code).map((p) => p.student))
    out.push({ assignment: a, missing: roster.filter((s) => !have.has(s.code)), total: roster.length })
  }
  return out
}

// ---------- Students ----------
api.get('/students', (req, res) => {
  const klass = typeof req.query.class === 'string' && req.query.class ? req.query.class : undefined
  const students = listStudents(klass)
  const rows = students.map((s) => {
    const packets = packetsForStudent(s.code)
    const last = packets[0]?.lastAt ?? null
    const missing = listAssignments().filter((a) => a.klass === s.klass && (a.grade == null || s.grade == null || a.grade === s.grade) && !getPacket(s.code, a.code)).length
    return { ...s, samples: packets.length, lastScanned: last, missing }
  })
  const classes = [...new Set(listStudents().map((s) => s.klass))].sort()
  res.json({ students: rows, classes })
})

api.get('/students/search', (req, res) => {
  const q = String(req.query.q ?? '')
  res.json(q.trim() ? findStudentsByName(q) : [])
})

api.post('/students', (req, res) => {
  const b = req.body ?? {}
  if (!b.code || !b.name || !b.klass) return res.status(400).json({ error: 'code, name and class are required' })
  upsertStudent({ code: String(b.code).toUpperCase(), name: b.name, nameKo: b.nameKo ?? null, klass: b.klass, grade: b.grade ?? null, homeroom: b.homeroom ?? null, active: b.active ?? 1 })
  res.json(getStudent(String(b.code).toUpperCase()))
})

api.get('/students/:code', (req, res) => {
  const s = getStudent(req.params.code.toUpperCase())
  if (!s) return res.status(404).json({ error: 'no such student' })
  const packets = packetsForStudent(s.code).map((p) => ({ ...p, assignmentInfo: getAssignment(p.assignment) ?? null, pages: packetPages(p.student, p.assignment) }))
  const assigned = listAssignments().filter((a) => a.klass === s.klass && (a.grade == null || s.grade == null || a.grade === s.grade))
  const missing = assigned.filter((a) => !getPacket(s.code, a.code))
  res.json({ student: s, packets, missing, pages: pagesForStudent(s.code), skills: skillsForStudent(s.code), ratings: domainsForStudent(s.code), domains: domainList(), skillGroups: Object.fromEntries(skillVocabulary().map((d) => [d.name, d.group])) })
})

// ---------- Assignments ----------
api.get('/assignments', (_req, res) => {
  const rows = listAssignments().map((a) => {
    const packets = packetsForAssignment(a.code)
    const roster = listStudents(a.klass).filter((s) => s.active && (a.grade == null || s.grade == null || s.grade === a.grade))
    return { ...a, turnedIn: packets.length, complete: packets.filter((p) => p.complete && !p.closedIncomplete).length, roster: roster.length }
  })
  res.json(rows)
})

api.post('/assignments', (req, res) => {
  const b = req.body ?? {}
  if (!b.code || !b.title || !b.klass) return res.status(400).json({ error: 'code, title and class are required' })
  const code = String(b.code).toUpperCase()
  const before = getAssignment(code)
  upsertAssignment({
    code, title: b.title, klass: b.klass, grade: b.grade ?? null, assignedOn: b.assignedOn ?? null,
    sheets: Number(b.sheets ?? 1), twoSided: b.twoSided ? 1 : 0, tags: b.tags ?? '', notes: b.notes ?? null,
    sides: b.sides == null ? null : Number(b.sides),
  })
  // a rubric seed from Worksheet Studio (the worksheet's objective and skill) fills a rubric the teacher has not written yet
  if (b.rubric && typeof b.rubric === 'object' && !before?.rubric) setAssignmentRubric(code, JSON.stringify(cleanRubric(b.rubric)))
  res.json(getAssignment(code))
})

// Edit an assignment. The code stays: it is printed on pages already. Sheets
// or sides changing recounts every packet.
api.put('/assignments/:code', (req, res) => {
  const code = req.params.code.toUpperCase()
  const a = getAssignment(code)
  if (!a) return res.status(404).json({ error: 'no such assignment' })
  const b = req.body ?? {}
  upsertAssignment({
    code, title: b.title ?? a.title, klass: b.klass ?? a.klass, grade: b.grade === undefined ? a.grade : (b.grade === null || b.grade === '' ? null : Number(b.grade)),
    assignedOn: b.assignedOn === undefined ? a.assignedOn : b.assignedOn || null, sheets: Number(b.sheets ?? a.sheets), twoSided: b.twoSided === undefined ? a.twoSided : (b.twoSided ? 1 : 0),
    tags: b.tags ?? a.tags, notes: b.notes === undefined ? a.notes : b.notes, sides: b.sides === undefined ? a.sides : (b.sides === null || b.sides === '' ? null : Number(b.sides)),
  })
  refreshPacketsFor(code)
  res.json(getAssignment(code))
})

function cleanRubric(b: Partial<Rubric>): Rubric {
  const r = { ...DEFAULT_RUBRIC, ...b }
  return {
    criteria: Array.isArray(r.criteria) ? r.criteria.map(String).map((c) => c.trim()).filter(Boolean).slice(0, 12) : [],
    propose: r.propose !== false,
    domains: Array.isArray(r.domains) ? r.domains.map(String) : null,
    domainNotes: r.domainNotes && typeof r.domainNotes === 'object' ? Object.fromEntries(Object.entries(r.domainNotes).filter(([, v]) => typeof v === 'string' && v.trim()).map(([k, v]) => [k, String(v).trim()])) : {},
    // A focus that names a skill from the vocabulary takes the vocabulary's name, so Studio's tag and the analysis line up.
    focus: Array.isArray(r.focus) ? [...new Set(r.focus.map(String).map((c) => c.trim()).filter(Boolean).map((c) => { const k = canonicalSkill(c); return k.known ? k.name : c }))].slice(0, 8) : [],
    tone: (['warm', 'plain', 'playful'] as const).includes(r.tone) ? r.tone : 'warm',
    length: (['short', 'standard', 'full'] as const).includes(r.length) ? r.length : 'standard',
    fixitMax: Math.max(0, Math.min(10, Number(r.fixitMax ?? 6) || 6)),
    scoring: (['none', 'holistic4', 'outOf'] as const).includes(r.scoring) ? r.scoring : 'holistic4',
    scoreOf: r.scoring === 'outOf' && r.scoreOf ? Number(r.scoreOf) : null,
  }
}

api.put('/assignments/:code/rubric', (req, res) => {
  const code = req.params.code.toUpperCase()
  if (!getAssignment(code)) return res.status(404).json({ error: 'no such assignment' })
  setAssignmentRubric(code, JSON.stringify(cleanRubric(req.body ?? {})))
  res.json(parseRubric(getAssignment(code)!.rubric))
})

api.post('/assignments/:code/analysis', (req, res) => {
  const code = req.params.code.toUpperCase()
  if (!getAssignment(code)) return res.status(404).json({ error: 'no such assignment' })
  const text = typeof req.body?.analysis === 'string' ? req.body.analysis.trim() : ''
  setAssignmentAnalysis(code, text || null)
  res.json(getAssignment(code))
})

// Claude's answer about the whole class, pasted once: each student's part
// goes to their packet, the class part to the assignment.
api.post('/assignments/:code/analysis/paste', (req, res) => {
  const code = req.params.code.toUpperCase()
  const a = getAssignment(code)
  if (!a) return res.status(404).json({ error: 'no such assignment' })
  const text = String(req.body?.text ?? '')
  const packets = packetsForAssignment(code)
  const { byStudent, klass } = splitClassAnswer(text, packets.map((p) => p.student))
  const filed: string[] = []
  let withFeedback = 0
  for (const [student, body] of byStudent) {
    const pk = packets.find((p) => p.student === student)
    if (!pk) continue
    const parts = splitStudentSection(body, domainList(), skillVocabulary())
    setPacketScore(student, code, pk.score, pk.scoreOf, parts.teacher ?? body)
    if (parts.feedback) { setPacketFeedback(student, code, parts.feedback); withFeedback++ }
    if (parts.skills.length) replaceSkills(student, code, parts.skills.map((k) => ({ name: k.name, level: k.level, evidence: k.evidence ?? '', at: pk.lastAt })))
    if (parts.progress) {
      const was = latestLevels(studentHistory(student, code))
      setPacketProgress(student, code, { items: parts.progress.items.map((i) => ({ ...i, from: i.from ?? was.get(i.skill) ?? null })), followedUp: parts.progress.followedUp })
    }
    if (parts.domains.length) replaceDomains(student, code, parts.domains, pk.lastAt)
    if (parts.corrections.length) setPacketCorrections(student, code, parts.corrections)
    if (parts.criteria.length) setPacketCriteria(student, code, parts.criteria)
    filed.push(student)
  }
  if (klass) setAssignmentAnalysis(code, klass)
  res.json({ students: filed, withFeedback, klass: !!klass, unmatched: packets.filter((p) => !byStudent.has(p.student)).map((p) => p.student) })
})

api.get('/assignments/:code/prompt', (req, res) => {
  const code = req.params.code.toUpperCase()
  const a = getAssignment(code)
  if (!a) return res.status(404).json({ error: 'no such assignment' })
  const students = packetsForAssignment(code).map((p) => {
    const s = getStudent(p.student)
    const name = s?.name ?? p.student
    const first = (/\(([^)]+)\)\s*$/.exec(name)?.[1] ?? name.split(/\s+/)[0]).trim()
    return { code: p.student, name, pages: packetPages(p.student, code).length, history: historyText(studentHistory(p.student, code), first) || undefined }
  }).sort((x, y) => x.name.localeCompare(y.name))
  const rubric = parseRubric(a.rubric)
  res.type('text').send(classPrompt(a, students, domainsFor(rubric), rubric, skillVocabulary()))
})

// The whole class as one PDF, students in name order, each page under a header line.
api.get('/assignments/:code/pdf', async (req, res) => {
  const code = req.params.code.toUpperCase()
  const a = getAssignment(code)
  if (!a) return res.status(404).json({ error: 'no such assignment' })
  const sections = packetsForAssignment(code)
    .map((p) => ({ student: getStudent(p.student) ?? ({ code: p.student, name: p.student } as Student), pages: packetPages(p.student, code) }))
    .filter((s) => s.pages.length)
    .sort((x, y) => x.student.name.localeCompare(y.student.name))
  if (!sections.length) return res.status(404).json({ error: 'nothing scanned for this assignment yet' })
  try {
    const pdf = await buildPdf(a, sections)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(`${a.code} ${a.title} - class.pdf`)}"`)
    res.send(Buffer.from(pdf))
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

api.get('/packets/:assignment/:student/pdf', async (req, res) => {
  const assignment = req.params.assignment.toUpperCase(), student = req.params.student.toUpperCase()
  const a = getAssignment(assignment)
  const s = getStudent(student)
  if (!a || !s) return res.status(404).json({ error: 'no such packet' })
  const pages = packetPages(student, assignment)
  if (!pages.length) return res.status(404).json({ error: 'no pages filed' })
  try {
    const pdf = await buildPdf(a, [{ student: s, pages }])
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${encodeURIComponent(`${a.code} ${s.name}.pdf`)}"`)
    res.send(Buffer.from(pdf))
  } catch (err) {
    res.status(500).json({ error: (err as Error).message })
  }
})

// The pages of a packet in a new order: sides renumbered by position.
api.post('/packets/:assignment/:student/order', (req, res) => {
  const ids = Array.isArray(req.body?.pageIds) ? (req.body.pageIds as unknown[]).map(Number) : []
  try {
    res.json(reorderPacket(req.params.student.toUpperCase(), req.params.assignment.toUpperCase(), ids))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

api.post('/pages/:id/unfile', (req, res) => {
  try {
    res.json(unfilePage(Number(req.params.id)))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

api.delete('/assignments/:code', (req, res) => {
  const code = req.params.code.toUpperCase()
  if (!getAssignment(code)) return res.status(404).json({ error: 'no such assignment' })
  if (!deleteAssignment(code)) return res.status(409).json({ error: `${code} has scanned work filed under it, so it stays. Pages can be skipped or refiled from Review first.` })
  res.json({ deleted: code })
})

api.get('/assignments/:code', (req, res) => {
  const a = getAssignment(req.params.code.toUpperCase())
  if (!a) return res.status(404).json({ error: 'no such assignment' })
  const roster = listStudents(a.klass).filter((s) => s.active && (a.grade == null || s.grade == null || s.grade === a.grade))
  const packets = new Map(packetsForAssignment(a.code).map((p) => [p.student, p]))
  // Anyone who turned this in but is outside the usual roster (another grade, inactive) still shows.
  for (const code of packets.keys()) if (!roster.some((s) => s.code === code)) { const s = getStudent(code); if (s) roster.push(s) }
  const students = roster.map((s) => {
    const p = packets.get(s.code)
    return { ...s, packet: p ?? null, pages: p ? packetPages(s.code, a.code) : [] }
  })
  const inReview = reviewPages().filter((p) => p.assignment === a.code).length
  const scored = [...packets.values()].filter((p) => p.score != null)
  const average = scored.length ? scored.reduce((t, p) => t + (p.score ?? 0), 0) / scored.length : null
  const noticingRaw = getMeta(`noticing:${a.code}`)
  const rubric = parseRubric(a.rubric)
  res.json({ assignment: a, expected: expectedFor(a), students, inReview, average, scoredCount: scored.length, noticing: noticingRaw ? JSON.parse(noticingRaw) : null, analysisOn: getSettings().hasKey, domains: domainsFor(rubric), allDomains: domainList(), rubric, ratings: domainsForAssignment(a.code) })
})

api.post('/packets/:assignment/:student/score', (req, res) => {
  const { assignment, student } = req.params
  if (!getPacket(student, assignment)) return res.status(404).json({ error: 'no such packet' })
  const b = req.body ?? {}
  setPacketScore(student, assignment, b.score == null ? null : Number(b.score), b.scoreOf == null ? null : Number(b.scoreOf), b.note ?? null)
  if (b.feedback !== undefined) setPacketFeedback(student, assignment, typeof b.feedback === 'string' && b.feedback.trim() ? b.feedback.trim() : null)
  if (b.corrections !== undefined) setPacketCorrections(student, assignment, typeof b.corrections === 'string' ? parseCorrectionLines(b.corrections) : Array.isArray(b.corrections) ? b.corrections : null)
  res.json(getPacket(student, assignment))
})

api.post('/packets/:assignment/:student/domains', (req, res) => {
  const assignment = req.params.assignment.toUpperCase(), student = req.params.student.toUpperCase()
  const pk = getPacket(student, assignment)
  if (!pk) return res.status(404).json({ error: 'no such packet' })
  const rows = Array.isArray(req.body?.domains) ? (req.body.domains as Array<{ domain: string; level: number; note?: string | null }>).filter((r) => r.domain && r.level) : []
  replaceDomains(student, assignment, rows.map((r) => ({ domain: String(r.domain), level: Number(r.level), note: r.note ?? null })), pk.lastAt)
  res.json(domainsForAssignment(assignment).filter((r) => r.student === student))
})

// ---------- Compare ----------
api.get('/compare', (req, res) => {
  const assignment = String(req.query.assignment ?? '').toUpperCase()
  const left = String(req.query.left ?? '').toUpperCase()
  const right = String(req.query.right ?? '').toUpperCase()
  const a = getAssignment(assignment)
  if (!a) return res.status(404).json({ error: 'no such assignment' })
  const side = (code: string) => {
    const s = getStudent(code)
    if (!s) return null
    return { student: s, packet: getPacket(code, assignment) ?? null, pages: packetPages(code, assignment) }
  }
  res.json({ assignment: a, sides: sidesFor(a), left: side(left), right: side(right) })
})

// ---------- Review ----------
api.get('/review', (_req, res) => {
  const students = new Map(listStudents().map((s) => [s.code, s]))
  const items: ReviewItem[] = reviewPages().map((p) => ({
    kind: 'page', pageId: p.id, student: p.student, assignment: p.assignment, scannedAt: p.scannedAt,
    problem: p.reason ?? 'Code not readable', guesses: guessesFor(p), waitingSince: p.scannedAt,
  }))
  for (const pk of stalePackets()) {
    const a = getAssignment(pk.assignment)
    const have = new Set(packetPages(pk.student, pk.assignment).map((p) => `${p.page}${p.side}`))
    const missing = a ? sidesFor(a).filter((e) => !have.has(`${e.page}${e.side}`)) : []
    items.push({
      kind: 'packet', pageId: null, student: pk.student, assignment: pk.assignment, scannedAt: pk.lastAt,
      problem: `Packet incomplete after ${Math.round((Date.now() - Date.parse(pk.lastAt)) / 3600000)} hours; ${missing.map((m) => sideLabel(m.page, m.side)).join(' and ')} never arrived`,
      guesses: [{ rank: 1, student: pk.student, studentName: students.get(pk.student)?.name ?? pk.student, assignment: pk.assignment, page: null, side: null, why: `File as ${pk.sides} of ${pk.expected}.` }],
      waitingSince: pk.lastAt,
    })
  }
  items.sort((x, y) => x.waitingSince.localeCompare(y.waitingSince))
  const pages = Object.fromEntries(items.filter((i) => i.pageId).map((i) => [i.pageId!, getPage(i.pageId!)]))
  res.json({ items, pages, assignments: listAssignments(), filedThisWeek: filedFromReviewThisWeek(), autoThisWeek: autoFiledThisWeek() })
})

function filedFromReviewThisWeek() {
  return pagesSince(new Date(Date.now() - 7 * 86400_000).toISOString()).filter((p) => p.filedFrom === 'review').length
}
function autoFiledThisWeek() {
  return pagesSince(new Date(Date.now() - 7 * 86400_000).toISOString()).filter((p) => p.filedFrom === 'code').length
}

api.post('/review/skip-all', (req, res) => {
  res.json({ skipped: skipAllInReview(!!req.body?.notWork) })
})

api.post('/review/:id/file', (req, res) => {
  const b = req.body ?? {}
  const side = String(b.side ?? 'a').toLowerCase() as Side
  if (!b.student || !b.assignment || !b.page || !['a', 'b'].includes(side)) return res.status(400).json({ error: 'student, assignment, page and side are required' })
  try {
    const page = fileFromReview(Number(req.params.id), { student: String(b.student).toUpperCase(), assignment: String(b.assignment).toUpperCase(), page: Number(b.page), side }, !!b.allowDuplicate)
    res.json(page)
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

// A whole stack filed at once: pages scanned in order without codes, cut into
// packets by the caller, each page told whose it is and which side.
api.post('/review/batch', (req, res) => {
  const items = Array.isArray(req.body?.items) ? (req.body.items as Array<{ pageId: number; student: string; assignment: string; page: number; side: string }>) : []
  if (!items.length) return res.status(400).json({ error: 'nothing to file' })
  const filed: number[] = []
  const failed: Array<{ pageId: number; error: string }> = []
  for (const it of items) {
    try {
      fileFromReview(Number(it.pageId), { student: String(it.student).toUpperCase(), assignment: String(it.assignment).toUpperCase(), page: Number(it.page), side: String(it.side).toLowerCase() as Side }, false)
      filed.push(Number(it.pageId))
    } catch (err) {
      failed.push({ pageId: Number(it.pageId), error: (err as Error).message })
    }
  }
  res.json({ filed, failed })
})

api.post('/review/:id/skip', (req, res) => {
  try {
    res.json(skipFromReview(Number(req.params.id), !!req.body?.notWork))
  } catch (err) {
    res.status(400).json({ error: (err as Error).message })
  }
})

api.post('/review/packet/:assignment/:student/close', (req, res) => {
  const { assignment, student } = req.params
  if (!getPacket(student, assignment)) return res.status(404).json({ error: 'no such packet' })
  closePacketIncomplete(student, assignment)
  res.json(getPacket(student, assignment))
})

// ---------- Settings and the analysis step ----------
api.get('/settings', (_req, res) => res.json(getSettings()))
api.post('/settings', (req, res) => {
  const b = req.body ?? {}
  saveSettings({ apiKey: b.apiKey === undefined ? undefined : (b.apiKey || null), model: b.model, auto: b.auto === undefined ? undefined : !!b.auto, context: b.context, domains: Array.isArray(b.domains) ? b.domains.map(String) : undefined, skills: typeof b.skills === 'string' ? b.skills : undefined })
  res.json(getSettings())
})
api.post('/settings/test', async (_req, res) => res.json(await testKey()))

api.get('/analyse', (_req, res) => res.json(queueStatus()))
api.post('/analyse/packet/:assignment/:student', (req, res) => {
  const assignment = req.params.assignment.toUpperCase(), student = req.params.student.toUpperCase()
  if (!getPacket(student, assignment)) return res.status(404).json({ error: 'no such packet' })
  if (!getSettings().hasKey) return res.status(400).json({ error: 'No API key yet. Add one in Settings.' })
  enqueuePacket(assignment, student)
  res.json(queueStatus())
})
api.post('/analyse/assignment/:code', (req, res) => {
  const code = req.params.code.toUpperCase()
  if (!getAssignment(code)) return res.status(404).json({ error: 'no such assignment' })
  if (!getSettings().hasKey) return res.status(400).json({ error: 'No API key yet. Add one in Settings.' })
  const n = enqueueAssignment(code, !!req.body?.force)
  res.json({ queued: n, ...queueStatus() })
})
api.post('/analyse/class/:code', (req, res) => {
  const code = req.params.code.toUpperCase()
  if (!getAssignment(code)) return res.status(404).json({ error: 'no such assignment' })
  if (!getSettings().hasKey) return res.status(400).json({ error: 'No API key yet. Add one in Settings.' })
  enqueueClass(code)
  res.json(queueStatus())
})
// The skill vocabulary, for Worksheet Studio to tag worksheets with the same names the analysis uses.
api.get('/skills', (_req, res) => {
  const defs = skillVocabulary()
  res.json({ skills: defs, groups: skillGroups(defs) })
})
api.get('/skills/student/:code', (req, res) => res.json(skillsForStudent(req.params.code.toUpperCase())))
api.get('/skills/assignment/:code', (req, res) => res.json(skillsForAssignment(req.params.code.toUpperCase())))

// ---------- Files ----------
export const files = Router()
files.get('/*path', (req, res) => {
  const relPath = (req.params as any).path
  const joined = Array.isArray(relPath) ? relPath.join('/') : String(relPath)
  if (joined.includes('..')) return res.status(400).end()
  const file = abs(joined)
  if (!fs.existsSync(file)) return res.status(404).end()
  res.sendFile(path.resolve(file))
})

// ---------- Print: one QR label per student per side of an assignment ----------
export const print = Router()
print.get('/labels/:assignment', async (req, res) => {
  const a = getAssignment(req.params.assignment.toUpperCase())
  if (!a) return res.status(404).send('no such assignment')
  const roster = listStudents(a.klass).filter((s) => s.active && (a.grade == null || s.grade == null || s.grade === a.grade))
  const sides = sidesFor(a)
  const labels: string[] = []
  for (const s of roster) {
    for (const sd of sides) {
      const code = formatCode({ student: s.code, assignment: a.code, page: sd.page, side: sd.side })
      const svg = await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'H', width: 96 })
      labels.push(`<div class="label">${svg}<div class="t"><b>${esc(s.name)}</b><span>${s.code} · ${a.code} · ${sideLabel(sd.page, sd.side)}</span></div></div>`)
    }
  }
  res.type('html').send(`<!doctype html><html><head><meta charset="utf-8"><title>Labels ${esc(a.code)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:0;padding:10mm;color:#111}
h1{font-size:14px;margin:0 0 6mm}
.grid{display:grid;grid-template-columns:repeat(4,1fr);gap:4mm}
.label{display:flex;gap:3mm;align-items:center;border:1px dashed #bbb;padding:2mm;break-inside:avoid}
.label svg{width:22mm;height:22mm;flex:none}
.t{display:flex;flex-direction:column;font-size:11px;line-height:1.3}
.t b{font-size:13px}
@media print{h1{display:none}.label{border-color:#ddd}}
</style></head><body>
<h1>${esc(a.code)} · ${esc(a.title)} · ${roster.length} students × ${sides.length} sides. Stick one on the top right corner of each side, or paste the codes into the worksheet before printing.</h1>
<div class="grid">${labels.join('')}</div></body></html>`)
})

// Feedback slips: the note to each student, two to an A4 page with a cut line,
// or one a page with ?per=1. Use the browser's print dialog to print or save as PDF.
print.get('/feedback/:assignment{/:student}', (req, res) => {
  const a = getAssignment(req.params.assignment.toUpperCase())
  if (!a) return res.status(404).send('no such assignment')
  const only = typeof req.params.student === 'string' ? req.params.student.toUpperCase() : null
  const per = req.query.per === '1' ? 1 : 2
  const packets = packetsForAssignment(a.code).filter((p) => (p.feedback || parseCorrections(p.corrections).length) && (!only || p.student === only))
  const rows = packets.map((p) => ({ p, s: getStudent(p.student) })).sort((x, y) => (x.s?.name ?? '').localeCompare(y.s?.name ?? ''))
  if (!rows.length) return res.status(404).send(only ? 'No feedback written for this student yet.' : 'No feedback written for this assignment yet.')
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const first = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const slips = rows.map(({ p, s }) => `<section class="slip">
    <header><div><div class="over">${esc(a.klass)}${a.grade != null ? ` · Grade ${a.grade}` : ''} · ${esc(date)}</div><h1>${esc(s?.name ? first(s.name) : p.student)}${s?.nameKo ? ` <span class="ko">${esc(s.nameKo)}</span>` : ''}</h1></div><div class="right"><div class="over">${esc(a.code)}</div><div class="title">${esc(a.title)}</div></div></header>
    <div class="body">${(p.feedback ?? '').split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('')}</div>
    ${fixitTable(parseCorrections(p.corrections), (a.grade ?? s?.grade ?? 3) <= 2)}
    <footer><span>${p.score != null ? `Score ${p.score}${p.scoreOf != null ? ` of ${p.scoreOf}` : ''}` : ''}</span><span>Keep this with your work</span></footer>
  </section>`)
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feedback · ${esc(a.code)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+KR:wght@400;500&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:10mm 14mm}
body{margin:0;font-family:'IBM Plex Sans','Noto Sans KR',system-ui,sans-serif;color:#1f1b17;background:#fff}
/* slips flow down the page: a short one takes half a page so two share a sheet; a long one takes what it needs, never split across pages */
.slip{box-sizing:border-box;min-height:${per === 1 ? '275mm' : '136mm'};padding:5mm 2mm 4mm;display:flex;flex-direction:column;gap:3.5mm;position:relative;break-inside:avoid;page-break-inside:avoid;border-bottom:1px dashed #cfc5b4}
.slip:last-child{border-bottom:0}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;border-bottom:2px solid #8b1e1e;padding-bottom:2.5mm}
.over{font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:#8b1e1e;font-weight:600}
h1{font-family:'Playfair Display',Georgia,serif;font-size:20pt;margin:1mm 0 0;line-height:1.1}
.ko{font-family:'Noto Sans KR',sans-serif;font-size:12pt;font-weight:500;color:#6b6259;margin-left:2mm}
.right{text-align:right}.title{font-size:10.5pt;color:#3b342d}
.body{font-size:${per === 1 ? '12.5pt' : '11pt'};line-height:1.55}
.body p{margin:0 0 2mm}
.fix{width:100%;border-collapse:collapse;font-size:${per === 1 ? '11pt' : '9.5pt'};line-height:1.35}
.fix caption{text-align:left;font-size:9pt;letter-spacing:.14em;text-transform:uppercase;color:#8b1e1e;font-weight:600;padding:0 0 1.2mm}
.fix th{font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#6b6259;text-align:left;font-weight:600;padding:1mm 2mm;border-bottom:1px solid #d9d0c1}
.fix td{padding:1.3mm 2mm;border-bottom:1px solid #e6ddcf;vertical-align:top}
.fix .w{color:#8b1e1e;text-decoration:line-through;text-decoration-color:rgba(139,30,30,.5);width:32%}
.fix .b{font-weight:600;color:#2f7d4f;width:32%}
.fix .y{color:#3b342d}
footer{display:flex;justify-content:space-between;font-size:8.5pt;color:#6b6259;border-top:1px solid #e6ddcf;padding-top:1.5mm;margin-top:auto}
.bar{position:fixed;top:0;left:0;right:0;background:#1f1b17;color:#fff;padding:8px 14px;font-size:13px;display:flex;gap:14px;align-items:center;z-index:9}
.bar button{font:inherit;background:#8b1e1e;color:#fff;border:0;border-radius:3px;padding:5px 12px;cursor:pointer}
@media print{.bar{display:none}}
@media screen{body{background:#e6e3db;padding:56px 0 24px}.sheet{width:182mm;margin:0 auto;background:#fff;padding:10mm 14mm;box-shadow:0 1px 4px rgba(0,0,0,.15)}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print, or save as PDF</button><span>${rows.length} slip${rows.length === 1 ? '' : 's'} · ${per === 1 ? 'one a page' : 'two a page when they fit; a long one takes a page'}</span><a style="color:#fff" href="?per=${per === 1 ? 2 : 1}">${per === 1 ? 'Two a page' : 'One a page'}</a></div>
<div class="sheet">${slips.join('')}</div>
</body></html>`)
})

print.get('/overview/:assignment', (req, res) => {
  const a = getAssignment(req.params.assignment.toUpperCase())
  if (!a) return res.status(404).send('no such assignment')
  const rubric = parseRubric(a.rubric)
  const domains = domainsFor(rubric)
  const ratings = domainsForAssignment(a.code)
  const rows = packetsForAssignment(a.code).map((p) => ({ p, s: getStudent(p.student) })).sort((x, y) => (x.s?.name ?? '').localeCompare(y.s?.name ?? ''))
  if (!rows.length) return res.status(404).send('Nothing scanned for this assignment yet.')
  const anyCriteria = rows.some(({ p }) => parseCriteria(p.criteria).length)
  const metCount = (p: { criteria: string | null }) => { const cs = parseCriteria(p.criteria); return cs.length ? `${cs.filter((c) => c.met).length}/${cs.length}` : '' }
  const level = (student: string, domain: string) => ratings.find((r) => r.student === student && r.domain === domain)
  const avg = (domain: string) => { const xs = ratings.filter((r) => r.domain === domain).map((r) => r.level); return xs.length ? (xs.reduce((t, x) => t + x, 0) / xs.length).toFixed(1) : '' }
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const short = (d: string) => d.split(':')[0].trim()
  const table = `<table><thead><tr><th>Student</th><th>Code</th><th class="n">Score</th>${anyCriteria ? '<th class="n">Criteria met</th>' : ''}${domains.map((d) => `<th class="n" title="${esc(d)}">${esc(short(d))}</th>`).join('')}<th class="n">Sides</th></tr></thead><tbody>
${rows.map(({ p, s }) => `<tr><td><b>${esc(s?.name ?? p.student)}</b>${s?.nameKo ? `<span class="ko">${esc(s.nameKo)}</span>` : ''}</td><td class="muted">${esc(p.student)}</td><td class="n">${p.score != null ? `${p.score}${p.scoreOf != null ? `/${p.scoreOf}` : ''}` : '—'}</td>${anyCriteria ? `<td class="n">${metCount(p)}</td>` : ''}${domains.map((d) => { const r = level(p.student, d); return `<td class="n lv${r?.level ?? 0}" title="${r?.note ? esc(r.note) : ''}">${r ? r.level : '·'}</td>` }).join('')}<td class="n muted">${p.sides}/${p.expected}</td></tr>`).join('\n')}
</tbody><tfoot><tr><td colspan="${anyCriteria ? 4 : 3}">Class average</td>${domains.map((d) => `<td class="n">${avg(d)}</td>`).join('')}<td></td></tr></tfoot></table>`
  const records = rows.filter(({ p }) => p.note || p.feedback).map(({ p, s }) => {
    const rs = domains.map((d) => level(p.student, d)).filter((r): r is NonNullable<typeof r> => !!r)
    return `<section class="rec"><h2>${esc(s?.name ?? p.student)} <span class="muted">${esc(p.student)}${p.score != null ? ` · ${p.score}${p.scoreOf != null ? ` of ${p.scoreOf}` : ''}` : ''}</span></h2>
    ${rs.length ? `<div class="chips">${rs.map((r) => `<span class="chip lv${r.level}"><b>${esc(short(r.domain))}</b> ${r.level} ${esc(LEVELS[r.level] ?? '')}${r.note ? ` · ${esc(r.note)}` : ''}</span>`).join('')}</div>` : ''}
    ${parseCriteria(p.criteria).length ? `<ul class="crit">${parseCriteria(p.criteria).map((c) => `<li class="${c.met ? 'met' : 'not'}"><span>${c.met ? '✓' : '✗'}</span> ${esc(c.criterion)}${c.evidence ? ` <i>· ${esc(c.evidence)}</i>` : ''}</li>`).join('')}</ul>` : ''}
    ${progressHtml(p.progress)}
    <div class="two">${p.note ? `<div><div class="over">For the teacher</div>${p.note.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}${p.feedback ? `<div><div class="over">To the student</div>${p.feedback.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('')}</div>` : ''}</div></section>`
  })
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Record · ${esc(a.code)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+KR:wght@400;500&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:12mm}
@page wide{size:A4 landscape;margin:12mm}
body{margin:0;font-family:'IBM Plex Sans','Noto Sans KR',system-ui,sans-serif;color:#1f1b17;background:#fff;font-size:10pt}
.sheet{page:wide;page-break-after:always}
.over{font-size:8.5pt;letter-spacing:.14em;text-transform:uppercase;color:#8b1e1e;font-weight:600;margin-bottom:2mm}
h1{font-family:'Playfair Display',Georgia,serif;font-size:20pt;margin:0 0 1mm}
.sub{color:#6b6259;margin-bottom:5mm}
table{width:100%;border-collapse:collapse;font-size:9.5pt}
th{font-size:8pt;letter-spacing:.08em;text-transform:uppercase;color:#6b6259;text-align:left;padding:2mm;border-bottom:1px solid #d9d0c1;vertical-align:bottom}
td{padding:1.6mm 2mm;border-bottom:1px solid #e6ddcf;vertical-align:top}
tfoot td{border-top:2px solid #d9d0c1;border-bottom:0;font-weight:600}
.n{text-align:center}.muted{color:#6b6259}.ko{display:block;font-size:8pt;color:#6b6259;font-family:'Noto Sans KR',sans-serif}
.lv4{background:#dff0e5}.lv3{background:#eef5e9}.lv2{background:#fff3d6}.lv1{background:#f8dcd8}
.key{display:flex;gap:6mm;font-size:8.5pt;color:#6b6259;margin-top:3mm}.key span{padding:0 2mm}
.rec{page-break-inside:avoid;border-top:1px solid #d9d0c1;padding:4mm 0 5mm}
.rec h2{font-family:'Playfair Display',Georgia,serif;font-size:14pt;margin:0 0 2mm}.rec h2 .muted{font-family:'IBM Plex Sans',sans-serif;font-size:9.5pt;font-weight:400}
.chips{display:flex;flex-wrap:wrap;gap:1.5mm;margin-bottom:3mm}.chip{font-size:8.5pt;padding:.6mm 2mm;border-radius:2px;border:1px solid #e6ddcf}
.two{display:grid;grid-template-columns:1fr 1fr;gap:6mm}.two p{margin:0 0 1.5mm;line-height:1.45}
.crit{list-style:none;margin:0 0 3mm;padding:0;display:grid;grid-template-columns:1fr 1fr;gap:1mm 6mm;font-size:9pt}.crit li span{display:inline-block;width:4mm;font-weight:700}.crit .met span{color:#2f7d4f}.crit .not span{color:#8b1e1e}.crit i{color:#6b6259}
.prog{display:flex;flex-wrap:wrap;gap:1.5mm;align-items:baseline;margin-bottom:3mm;font-size:9pt}.prog .over{margin:0 2mm 0 0}.prog .dir1{background:#dff0e5}.prog .dir-1{background:#f8dcd8}.prog i{color:#6b6259;flex-basis:100%}
.bar{position:fixed;top:0;left:0;right:0;background:#1f1b17;color:#fff;padding:8px 14px;font-size:13px;display:flex;gap:14px;align-items:center;z-index:9}
.bar button{font:inherit;background:#8b1e1e;color:#fff;border:0;border-radius:3px;padding:5px 12px;cursor:pointer}
@media print{.bar{display:none}}
@media screen{body{padding:56px 24px 24px;max-width:1100px;margin:0 auto}.sheet{margin-bottom:12mm}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print, or save as PDF</button><span>${rows.length} students · the table prints landscape, the records portrait</span></div>
<div class="sheet"><div class="over">${esc(a.klass)}${a.grade != null ? ` · Grade ${a.grade}` : ''} · ${esc(date)}</div><h1>${esc(a.code)} · ${esc(a.title)}</h1><div class="sub">Domain ratings 1 to 4 and scores for every student who turned the work in.${a.analysis ? ' The class summary follows the records.' : ''}</div>${table}
<div class="key"><span class="lv4">4 Strong</span><span class="lv3">3 Secure</span><span class="lv2">2 Developing</span><span class="lv1">1 Beginning</span><span>· not rated</span></div></div>
${records.length ? `<div class="over">Student records</div>${records.join('\n')}` : ''}
${a.analysis ? `<section class="rec"><h2>What the class shows</h2>${a.analysis.split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, '<br>')}</p>`).join('')}</section>` : ''}
</body></html>`)
})

print.get('/code/:student/:assignment/:page/:side.svg', async (req, res) => {
  const { student, assignment, page, side } = req.params
  const code = formatCode({ student: student.toUpperCase(), assignment: assignment.toUpperCase(), page: Number(page), side: side.toLowerCase() as Side })
  res.type('image/svg+xml').send(await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'H' }))
})

/** "Since last time" for the printed record: moved-up skills first, then the follow-up. */
function progressHtml(raw: string | null): string {
  const pr = parseProgress(raw)
  if (!pr) return ''
  const glyph = (d: ReturnType<typeof progressDirection>) => (d === 1 ? '↑' : d === -1 ? '↓' : d === 0 ? '→' : '·')
  const items = [...pr.items].sort((a, b) => (progressDirection(b) ?? -2) - (progressDirection(a) ?? -2))
  return `<div class="prog"><span class="over">Since last time</span>${items.map((i) => `<span class="chip dir${progressDirection(i) ?? 'n'}">${esc(i.skill)} <b>${i.from ? `${esc(SKILL_LEVEL_LABEL[i.from])} ${glyph(progressDirection(i))} ` : ''}${esc(SKILL_LEVEL_LABEL[i.to])}</b></span>`).join('')}${pr.followedUp ? `<i>${esc(pr.followedUp)}</i>` : ''}</div>`
}

function fixitTable(rows: Array<{ wrote: string; better: string; why: string | null }>, young: boolean): string {
  if (!rows.length) return ''
  const withWhy = !young && rows.some((r) => r.why)
  return `<table class="fix"><caption>Fix it</caption><thead><tr><th>You wrote</th><th>Try</th>${withWhy ? '<th>Why</th>' : ''}</tr></thead><tbody>${rows.map((r) => `<tr><td class="w">${esc(r.wrote)}</td><td class="b">${esc(r.better)}</td>${withWhy ? `<td class="y">${esc(r.why ?? '')}</td>` : ''}</tr>`).join('')}</tbody></table>`
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
