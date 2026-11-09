import { Router } from 'express'
import fs from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import {
  allPackets, expectedFor, findStudentsByName, getAssignment, getPacket, getStudent, listAssignments, listStudents,
  packetPages, packetsForAssignment, packetsForStudent, pagesForStudent, pagesSince, recentPages, reviewPages,
  setPacketScore, upsertAssignment, upsertStudent, closePacketIncomplete, getPage, getMeta, sidesFor, deleteAssignment,
  refreshPacketsFor, setAssignmentAnalysis, setPacketFeedback,
} from '../db.js'
import { subscribe } from '../events.js'
import { guessesFor } from '../guesses.js'
import { abs, fileFromReview, reorderPacket, skipAllInReview, skipFromReview, stalePackets, unfilePage } from '../pipeline.js'
import { buildPdf } from '../pdf.js'
import { classPrompt, splitClassAnswer, splitStudentSection } from '../analysis.js'
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
    sides: b.sides == null ? null : Number(b.sides),
  })
  res.json(getAssignment(String(b.code).toUpperCase()))
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
    const parts = splitStudentSection(body)
    setPacketScore(student, code, pk.score, pk.scoreOf, parts.teacher ?? body)
    if (parts.feedback) { setPacketFeedback(student, code, parts.feedback); withFeedback++ }
    filed.push(student)
  }
  if (klass) setAssignmentAnalysis(code, klass)
  res.json({ students: filed, withFeedback, klass: !!klass, unmatched: packets.filter((p) => !byStudent.has(p.student)).map((p) => p.student) })
})

api.get('/assignments/:code/prompt', (req, res) => {
  const code = req.params.code.toUpperCase()
  const a = getAssignment(code)
  if (!a) return res.status(404).json({ error: 'no such assignment' })
  const students = packetsForAssignment(code).map((p) => ({ code: p.student, name: getStudent(p.student)?.name ?? p.student, pages: packetPages(p.student, code).length })).sort((x, y) => x.name.localeCompare(y.name))
  res.type('text').send(classPrompt(a, students))
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
  res.json({ assignment: a, expected: expectedFor(a), students, inReview, average, scoredCount: scored.length })
})

api.post('/packets/:assignment/:student/score', (req, res) => {
  const { assignment, student } = req.params
  if (!getPacket(student, assignment)) return res.status(404).json({ error: 'no such packet' })
  const b = req.body ?? {}
  setPacketScore(student, assignment, b.score == null ? null : Number(b.score), b.scoreOf == null ? null : Number(b.scoreOf), b.note ?? null)
  if (b.feedback !== undefined) setPacketFeedback(student, assignment, typeof b.feedback === 'string' && b.feedback.trim() ? b.feedback.trim() : null)
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
  const packets = packetsForAssignment(a.code).filter((p) => p.feedback && (!only || p.student === only))
  const rows = packets.map((p) => ({ p, s: getStudent(p.student) })).sort((x, y) => (x.s?.name ?? '').localeCompare(y.s?.name ?? ''))
  if (!rows.length) return res.status(404).send(only ? 'No feedback written for this student yet.' : 'No feedback written for this assignment yet.')
  const date = new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })
  const first = (name: string) => name.replace(/\s*\([^)]*\)\s*$/, '').trim()
  const slips = rows.map(({ p, s }) => `<section class="slip">
    <header><div><div class="over">${esc(a.klass)}${a.grade != null ? ` · Grade ${a.grade}` : ''} · ${esc(date)}</div><h1>${esc(s?.name ? first(s.name) : p.student)}${s?.nameKo ? ` <span class="ko">${esc(s.nameKo)}</span>` : ''}</h1></div><div class="right"><div class="over">${esc(a.code)}</div><div class="title">${esc(a.title)}</div></div></header>
    <div class="body">${p.feedback!.split(/\n{2,}/).map((para) => `<p>${esc(para).replace(/\n/g, '<br>')}</p>`).join('')}</div>
    <footer><span>${p.score != null ? `Score ${p.score}${p.scoreOf != null ? ` of ${p.scoreOf}` : ''}` : ''}</span><span>Keep this with your work</span></footer>
  </section>`)
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Feedback · ${esc(a.code)}</title>
<link href="https://fonts.googleapis.com/css2?family=Playfair+Display:wght@700&family=IBM+Plex+Sans:wght@400;500;600&family=Noto+Sans+KR:wght@400;500&display=swap" rel="stylesheet">
<style>
@page{size:A4;margin:0}
body{margin:0;font-family:'IBM Plex Sans','Noto Sans KR',system-ui,sans-serif;color:#1f1b17;background:#fff}
.page{width:210mm;height:297mm;box-sizing:border-box;padding:12mm 14mm;display:grid;grid-template-rows:repeat(${per},1fr);gap:0;page-break-after:always;position:relative}
.page:last-child{page-break-after:auto}
.slip{box-sizing:border-box;padding:6mm 2mm;display:flex;flex-direction:column;gap:4mm;position:relative}
.slip+.slip{border-top:1px dashed #cfc5b4}
header{display:flex;justify-content:space-between;align-items:flex-end;gap:8mm;border-bottom:2px solid #8b1e1e;padding-bottom:3mm}
.over{font-size:9.5pt;letter-spacing:.14em;text-transform:uppercase;color:#8b1e1e;font-weight:600}
h1{font-family:'Playfair Display',Georgia,serif;font-size:22pt;margin:1mm 0 0;line-height:1.1}
.ko{font-family:'Noto Sans KR',sans-serif;font-size:13pt;font-weight:500;color:#6b6259;margin-left:2mm}
.right{text-align:right}.title{font-size:11pt;color:#3b342d}
.body{font-size:${per === 1 ? '13pt' : '11.5pt'};line-height:1.6;flex:1}
.body p{margin:0 0 2.5mm}
footer{display:flex;justify-content:space-between;font-size:9pt;color:#6b6259;border-top:1px solid #e6ddcf;padding-top:2mm}
.bar{position:fixed;top:0;left:0;right:0;background:#1f1b17;color:#fff;padding:8px 14px;font-size:13px;display:flex;gap:14px;align-items:center;z-index:9}
.bar button{font:inherit;background:#8b1e1e;color:#fff;border:0;border-radius:3px;padding:5px 12px;cursor:pointer}
@media print{.bar{display:none}}
@media screen{body{background:#e6e3db}.page{background:#fff;margin:48px auto 16px;box-shadow:0 1px 4px rgba(0,0,0,.15)}}
</style></head><body>
<div class="bar"><button onclick="window.print()">Print, or save as PDF</button><span>${rows.length} slip${rows.length === 1 ? '' : 's'} · ${per} a page</span><a style="color:#fff" href="?per=${per === 1 ? 2 : 1}">${per === 1 ? 'Two a page' : 'One a page'}</a></div>
${chunk(slips, per).map((g) => `<div class="page">${g.join('')}</div>`).join('')}
</body></html>`)
})

print.get('/code/:student/:assignment/:page/:side.svg', async (req, res) => {
  const { student, assignment, page, side } = req.params
  const code = formatCode({ student: student.toUpperCase(), assignment: assignment.toUpperCase(), page: Number(page), side: side.toLowerCase() as Side })
  res.type('image/svg+xml').send(await QRCode.toString(code, { type: 'svg', margin: 1, errorCorrectionLevel: 'H' }))
})

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n))
  return out
}

function esc(s: string) {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!)
}
