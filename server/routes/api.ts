import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import {
  allPackets, expectedFor, findStudentsByName, getAssignment, getPacket, getStudent, listAssignments, listStudents,
  packetPages, packetsForAssignment, packetsForStudent, pagesForStudent, pagesSince, recentPages, reviewPages,
  setPacketScore, upsertAssignment, upsertStudent, closePacketIncomplete, getPage, getMeta,
} from '../db.js'
import { subscribe } from '../events.js'
import { guessesFor } from '../guesses.js'
import { abs, fileFromReview, skipFromReview, stalePackets } from '../pipeline.js'
import { watcherStatus } from '../watcher.js'
import { expectedSides, formatCode, sideLabel } from '../codes.js'
import type { Assignment, ReviewItem, Side, Student } from '../../shared/types.js'

export const api = Router()

api.get('/events', (req, res) => subscribe(res))

api.get('/status', (_req, res) => {
  res.json({ ...watcherStatus(), lastSeen: watcherStatus().lastSeen ?? getMeta('lastSeen') })
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
  })
})

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
  res.json({ student: s, packets, missing, pages: pagesForStudent(s.code) })
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
  upsertAssignment({
    code: String(b.code).toUpperCase(), title: b.title, klass: b.klass, grade: b.grade ?? null, assignedOn: b.assignedOn ?? null,
    sheets: Number(b.sheets ?? 1), twoSided: b.twoSided ? 1 : 0, tags: b.tags ?? '', notes: b.notes ?? null,
  })
  res.json(getAssignment(String(b.code).toUpperCase()))
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
  res.json({ assignment: a, expected: expectedFor(a), students, inReview, average, scoredCount: scored.length })
})

api.post('/packets/:assignment/:student/score', (req, res) => {
  const { assignment, student } = req.params
  if (!getPacket(student, assignment)) return res.status(404).json({ error: 'no such packet' })
  const b = req.body ?? {}
  setPacketScore(student, assignment, b.score == null ? null : Number(b.score), b.scoreOf == null ? null : Number(b.scoreOf), b.note ?? null)
  res.json(getPacket(student, assignment))
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
  res.json({ assignment: a, sides: expectedSides(a.sheets, !!a.twoSided), left: side(left), right: side(right) })
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
    const missing = a ? expectedSides(a.sheets, !!a.twoSided).filter((e) => !have.has(`${e.page}${e.side}`)) : []
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
  const sides = expectedSides(a.sheets, !!a.twoSided)
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

print.get('/code/:student/:assignment/:page/:side.svg', async (req, res) => {
  const { student, assignment, page, side } = req.params
  const code = formatCode({ student: student.toUpperCase(), assignment: assignment.toUpperCase(), page: Number(page), side: side.toLowerCase() as Side })
  res.type('image/svg+xml').send(await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'H' }))
})

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
