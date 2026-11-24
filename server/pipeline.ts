import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import * as mupdf from 'mupdf'
import { ARCHIVE_DIR, DATA_DIR, HOLDING_DIR, INBOX_DIR, INCOMPLETE_AFTER_MIN, ORIGINALS_DIR, PDF_DPI, THUMBS_DIR } from './config.js'
import { decodePage, makeThumb } from './decode.js'
import { closePacketIncomplete, deletePacket, getAssignment, getPile, getPileByOrigin, getStudent, insertPage, insertPile, upsertAssignment, moveAnnotations, nextSeq, openPackets, packetPages, pilePages, refreshPacket, reviewPages, updatePage, getPage } from './db.js'
import { broadcast } from './events.js'
import type { Assignment, Packet, Page, PageRef, Pile, Side } from '../shared/types.js'
import { shortSide } from './codes.js'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'])

export function isScanFile(file: string) {
  const ext = path.extname(file).toLowerCase()
  return IMAGE_EXT.has(ext) || ext === '.pdf'
}

// One file from the inbox. A PDF is rendered to one JPEG per page, which are
// returned so the caller can process them next, in page order. An image is
// decoded and filed straight away; a page rendered from a PDF is held in its
// pile, and the pile is settled once its last page has been decoded.
export async function processInboxFile(file: string): Promise<string[]> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf') return splitPdf(file)
  if (!IMAGE_EXT.has(ext)) return []
  const from = originOf(file)
  await processImage(file, path.basename(file), from, from?.pile ?? null)
  if (from?.pile) {
    const pile = getPile(from.pile.id)
    // only a pile not yet settled settles by itself; a settled one changes only by the teacher's hand
    if (pile && unsettled(pile) && pilePages(pile.id).length === pile.pages) {
      // loaded here, not at the top: pileFiling files through this module
      const { settle } = await import('./pileFiling.js')
      settle(pile.id)
    }
  }
  return []
}

export interface Origin { origin: string; originPage: number }
export interface PileSlot { id: number; index: number }

// Which PDF (and pile) a rendered page came from. Pages rendered in this run
// are remembered by path; one left in the inbox from before a restart is
// matched to its PDF by name, since the rendered name is the PDF's plus __pNN,
// and rejoins that PDF's pile unless the pile already has a page at that place.
const rendered = new Map<string, Origin & { pile: PileSlot | null }>()
function originOf(file: string): (Origin & { pile: PileSlot | null }) | null {
  const known = rendered.get(file)
  if (known) {
    rendered.delete(file)
    return known
  }
  const m = /^(.+)__p(\d{2,})\.jpe?g$/i.exec(path.basename(file))
  if (!m) return null
  const pdf = path.join(ORIGINALS_DIR, `${m[1]}.pdf`)
  if (!fs.existsSync(pdf)) return null
  const origin = rel(pdf)
  const index = Number(m[2])
  const pile = getPileByOrigin(origin)
  const free = pile && unsettled(pile) && index >= 1 && index <= pile.pages && !pilePages(pile.id).some((p) => p.pileIndex === index)
  return { origin, originPage: index, pile: free ? { id: pile.id, index } : null }
}
function unsettled(pile: Pile) {
  return pile.status === 'new' && !pile.settledAt
}
/** Forgets which rendered pages came from which PDF, as a restart does. For tests. */
export function forgetRendered() {
  rendered.clear()
}

// A free name under originals/: the PDF's own, or with -2, -3 … when a scanner
// reuses names from one day to the next.
function originalsPath(file: string) {
  const ext = path.extname(file)
  const stem = path.basename(file, ext)
  let dest = path.join(ORIGINALS_DIR, `${stem}${ext}`)
  for (let n = 2; fs.existsSync(dest); n++) dest = path.join(ORIGINALS_DIR, `${stem}-${n}${ext}`)
  return dest
}

// Renders each PDF page with MuPDF (bundled as WebAssembly, so nothing to
// install) into the inbox as JPEGs named after the PDF, then moves the PDF to
// originals/ so the scan itself is never lost.
async function splitPdf(file: string): Promise<string[]> {
  // Pages are named after the PDF as it will be kept (scan001-2 when scan001 is taken), so a page
  // left over from before a restart finds its own PDF and pile by name.
  fs.mkdirSync(ORIGINALS_DIR, { recursive: true })
  const kept = originalsPath(file)
  const stem = path.basename(kept, path.extname(kept))
  const out: string[] = []
  try {
    const doc = mupdf.Document.openDocument(fs.readFileSync(file), 'application/pdf')
    const n = doc.countPages()
    if (n === 0) throw new Error('PDF has no pages')
    for (let i = 0; i < n; i++) {
      const page = doc.loadPage(i)
      const [x0, y0, x1, y1] = page.getBounds()
      // Aim for PDF_DPI, but never wider than 2500 px: scanner PDFs sometimes
      // declare huge page sizes and the code reads fine at that width anyway.
      const scale = Math.min(PDF_DPI / 72, 2500 / Math.max(1, x1 - x0))
      const pix = page.toPixmap(mupdf.Matrix.scale(scale, scale), mupdf.ColorSpace.DeviceRGB, false, true)
      const png = Buffer.from(pix.asPNG())
      const dest = path.join(INBOX_DIR, `${stem}__p${String(i + 1).padStart(2, '0')}.jpg`)
      await sharp(png).jpeg({ quality: 88 }).toFile(dest)
      pix.destroy()
      page.destroy()
      out.push(dest)
    }
    doc.destroy()
    fs.renameSync(file, kept)
    const pile = insertPile({ origin: rel(kept), name: path.basename(file), pages: n })
    out.forEach((f, i) => rendered.set(f, { origin: rel(kept), originPage: i + 1, pile: { id: pile.id, index: i + 1 } }))
    console.log(`[pdf] ${path.basename(file)}: ${n} page${n === 1 ? '' : 's'}, kept as ${rel(kept)}`)
    return out
  } catch (err) {
    console.error('[pdf] could not open', file, err)
    for (const f of out) fs.rmSync(f, { force: true })
    await processImageAsReview(file, path.basename(file), `PDF could not be opened (${(err as Error).message})`)
    return []
  }
}

async function processImageAsReview(file: string, sourceName: string, reason: string) {
  const at = new Date().toISOString()
  const seq = nextSeq()
  const dest = path.join(HOLDING_DIR, `${seq}-${sourceName}`)
  fs.renameSync(file, dest)
  const p = insertPage({
    status: 'review', student: null, assignment: null, page: null, side: null, scannedAt: at, seq, sourceName,
    filePath: rel(dest), thumbPath: null, width: null, height: null, decoded: null, reason, filedFrom: null,
  })
  broadcast('review', p)
}

// With `pile`, the page is only decoded and held (status 'review', reason
// 'in pile'): its pile files it when the whole pile is in.
export async function processImage(file: string, sourceName: string, from: Origin | null = null, pile: PileSlot | null = null): Promise<Page> {
  const at = new Date().toISOString()
  const seq = nextSeq()
  let decoded
  try {
    decoded = await decodePage(file)
  } catch (err) {
    console.error('[decode] failed', file, err)
    decoded = { text: null, ref: null, width: 0, height: 0, strategy: null }
  }
  const thumbName = `${seq}.jpg`
  const thumbAbs = path.join(THUMBS_DIR, thumbName)
  try {
    await makeThumb(file, thumbAbs)
  } catch (err) {
    console.error('[thumb] failed', file, err)
  }
  const thumbPath = fs.existsSync(thumbAbs) ? rel(thumbAbs) : null

  const ref = decoded.ref
  if (pile) {
    const dest = path.join(HOLDING_DIR, `${seq}-${sourceName}`)
    fs.renameSync(file, dest)
    const p = insertPage({
      status: 'review', student: ref?.student ?? null, assignment: ref?.assignment ?? null, page: ref?.page ?? null, side: ref?.side ?? null,
      scannedAt: at, seq, sourceName, filePath: rel(dest), thumbPath, width: decoded.width, height: decoded.height, decoded: decoded.text,
      reason: 'in pile', filedFrom: null, origin: from?.origin ?? null, originPage: from?.originPage ?? null, pile: pile.id, pileIndex: pile.index,
    })
    broadcast('review', p)
    return p
  }
  const problem = ref ? placementProblem(ref) : decoded.text ? `Code read as "${decoded.text}" but it is not one of ours` : 'Code not readable'

  if (ref && !problem) {
    // A side scanned again replaces the scan already there: the newer scan is
    // the one wanted, and its comments move over with it.
    const dup = duplicateOf(ref)
    const dest = archivePath(ref, sourceName)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    if (dup) keepReplaced(dup, dest)
    fs.renameSync(file, dest)
    const p = insertPage({
      status: 'filed', student: ref.student, assignment: ref.assignment, page: ref.page, side: ref.side, scannedAt: at, seq,
      sourceName, filePath: rel(dest), thumbPath, width: decoded.width, height: decoded.height, decoded: decoded.text, reason: null, filedFrom: 'code',
      origin: from?.origin ?? null, originPage: from?.originPage ?? null,
    })
    if (dup) replaceScan(dup, p)
    const packet = refreshPacket(ref.student, ref.assignment, at)
    broadcast('page', { page: p, packet })
    if (packet.complete) { broadcast('packet', packet); onComplete?.(packet) }
    return p
  }

  const dest = path.join(HOLDING_DIR, `${seq}-${sourceName}`)
  fs.renameSync(file, dest)
  const p = insertPage({
    status: 'review', student: ref?.student ?? null, assignment: ref?.assignment ?? null, page: ref?.page ?? null, side: ref?.side ?? null,
    scannedAt: at, seq, sourceName, filePath: rel(dest), thumbPath, width: decoded.width, height: decoded.height, decoded: decoded.text,
    reason: problem, filedFrom: null, origin: from?.origin ?? null, originPage: from?.originPage ?? null,
  })
  broadcast('review', p)
  return p
}

// A code that reads cleanly can still point at something we do not know.
function placementProblem(ref: PageRef): string | null {
  if (!getStudent(ref.student)) return `Code names student ${ref.student}, who is not on the roster`
  const a = getAssignment(ref.assignment)
  if (!a) return `Code names assignment ${ref.assignment}, which has not been set up`
  if (ref.page > a.sheets) return `Code says sheet ${ref.page} but ${a.code} has ${a.sheets}`
  if (ref.side === 'b' && !a.twoSided) return `Code says a back side but ${a.code} is single-sided`
  return null
}

/** Where a replaced scan's file is kept: beside the live one, '…/2b.jpg' → '…/2b.r12.jpg'. */
export function replacedPath(archivePath: string, oldPageId: number): string {
  const ext = path.extname(archivePath)
  return `${archivePath.slice(0, archivePath.length - ext.length)}.r${oldPageId}${ext}`
}

// Before a new scan takes the archive path, the old file moves aside and its record follows it.
function keepReplaced(old: Page, dest: string) {
  if (!fs.existsSync(dest)) return
  const kept = replacedPath(dest, old.id)
  fs.renameSync(dest, kept)
  updatePage(old.id, { filePath: rel(kept) })
}

// The earlier scan of a side steps aside for the new one. Its file was kept
// beside the archive path, so only the record and the comments change hands.
function replaceScan(old: Page, by: Page) {
  updatePage(old.id, { status: 'replaced', reason: `replaced by rescan, page ${by.id}` })
  moveAnnotations(old.id, by.id)
  console.log(`[rescan] ${old.student} ${old.assignment} ${shortSide(old.page!, old.side!)}: ${old.sourceName} replaced by ${by.sourceName}`)
}

/** Undo a rescan: the old scan goes back on file, and the scan that replaced it returns to review. */
export function restoreReplaced(oldPageId: number): Page {
  const old = getPage(oldPageId)
  if (!old) throw new Error('page not found')
  if (old.status !== 'replaced') throw new Error('page is not a replaced scan')
  const m = /page (\d+)$/.exec(old.reason ?? '')
  const by = m ? getPage(Number(m[1])) : undefined
  if (!by) throw new Error('the scan that replaced this one is gone')
  if (by.status !== 'filed') throw new Error('the scan that replaced this one has itself been replaced or moved')
  const kept = abs(old.filePath)
  const live = abs(by.filePath)
  if (kept === live || !new RegExp(`\\.r${old.id}\\.[^./]+$`).test(kept)) throw new Error('this replaced scan has no kept file to restore')
  if (!fs.existsSync(kept)) throw new Error('the replaced scan\'s file is gone')
  const archive = path.join(path.dirname(kept), path.basename(kept).replace(/\.r\d+(\.[^.]+)$/, '$1'))
  if (archive !== live && fs.existsSync(archive)) throw new Error('the archive path is occupied by another scan')
  // checks done: files first, records last
  const aside = path.join(HOLDING_DIR, `${by.seq}-${by.sourceName}`)
  const liveThere = fs.existsSync(live)
  if (liveThere) fs.renameSync(live, aside)
  try {
    fs.renameSync(kept, archive)
  } catch (err) {
    if (liveThere) fs.renameSync(aside, live)
    throw err
  }
  updatePage(by.id, { status: 'review', reason: 'undone', filedFrom: null, ...(liveThere ? { filePath: rel(aside) } : {}) })
  moveAnnotations(by.id, old.id)
  updatePage(old.id, { status: 'filed', filePath: rel(archive), reason: null })
  if (old.student && old.assignment) refreshPacket(old.student, old.assignment, old.scannedAt)
  return getPage(old.id)!
}

// Review decisions -----------------------------------------------------------

export function fileFromReview(pageId: number, ref: PageRef, allowDuplicate = false): Page {
  const p = getPage(pageId)
  if (!p) throw new Error('page not found')
  if (p.status !== 'review') throw new Error('page is not in review')
  if (!getStudent(ref.student)) throw new Error(`no student ${ref.student}`)
  const a = getAssignment(ref.assignment)
  if (!a) throw new Error(`no assignment ${ref.assignment}`)
  const dup = duplicateOf(ref)
  if (dup && !allowDuplicate) throw new Error(`${ref.student} already has ${shortSide(ref.page, ref.side)} of ${ref.assignment}`)
  const from = abs(p.filePath)
  const dest = archivePath(ref, p.sourceName)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  if (dup) keepReplaced(dup, dest)
  fs.renameSync(from, dest)
  updatePage(pageId, {
    status: 'filed', student: ref.student, assignment: ref.assignment, page: ref.page, side: ref.side, filePath: rel(dest), reason: null, filedFrom: 'review',
  })
  if (dup) replaceScan(dup, getPage(pageId)!)
  const packet = refreshPacket(ref.student, ref.assignment, p.scannedAt)
  const updated = getPage(pageId)!
  broadcast('page', { page: updated, packet })
  if (packet.complete) onComplete?.(packet)
  return updated
}

// Pages whose code named an assignment that was never set up: the codes say
// which students, how many sheets and whether there are backs, so the
// assignment is made from them and every one of those pages is filed.
export function setupAssignmentFromReview(code: string, given: { title?: string | null; klass?: string | null; grade?: number | null }): { assignment: Assignment; filed: number; failed: Array<{ pageId: number; error: string }> } {
  code = code.toUpperCase()
  const pages = reviewPages().filter((p) => p.assignment === code && p.student && p.page && p.side).sort((a, b) => a.seq - b.seq)
  if (!pages.length) throw new Error(`no pages waiting for ${code}`)
  if (!getAssignment(code)) {
    const students = pages.map((p) => getStudent(p.student!)).filter((s): s is NonNullable<typeof s> => !!s)
    const klass = given.klass?.trim() || mostCommon(students.map((s) => s.klass)) || 'Class'
    const grade = given.grade ?? mostCommon(students.map((s) => s.grade).filter((g): g is number => g != null)) ?? null
    upsertAssignment({
      code, title: given.title?.trim() || code, klass, grade, assignedOn: new Date().toISOString().slice(0, 10),
      sheets: Math.max(1, ...pages.map((p) => p.page!)), twoSided: pages.some((p) => p.side === 'b') ? 1 : 0, tags: '', notes: null,
    })
  }
  let filed = 0
  const failed: Array<{ pageId: number; error: string }> = []
  for (const p of pages) {
    try {
      fileFromReview(p.id, { student: p.student!, assignment: code, page: p.page!, side: p.side! }, true)
      filed++
    } catch (err) {
      failed.push({ pageId: p.id, error: (err as Error).message })
    }
  }
  return { assignment: getAssignment(code)!, filed, failed }
}
function mostCommon<T>(xs: T[]): T | undefined {
  const n = new Map<T, number>()
  for (const x of xs) n.set(x, (n.get(x) ?? 0) + 1)
  return [...n.entries()].sort((a, b) => b[1] - a[1])[0]?.[0]
}

// Set by the server at startup: what happens when a packet completes (the analysis step, when it is on).
let onComplete: ((packet: Packet) => void) | null = null
export function setOnPacketComplete(fn: (packet: Packet) => void) { onComplete = fn }

export function skipFromReview(pageId: number, notWork = false): Page {
  const p = getPage(pageId)
  if (!p) throw new Error('page not found')
  updatePage(pageId, { status: notWork ? 'not_work' : 'skipped' })
  const updated = getPage(pageId)!
  broadcast('review', updated)
  return updated
}

// The pages of one packet in the order given become sides 1 front, 1 back,
// 2 front … (or 1, 2, 3 front for single-sided work). Files are renamed in
// two steps so two pages swapping names never collide.
export function reorderPacket(student: string, assignment: string, pageIds: number[]): Page[] {
  const a = getAssignment(assignment)
  if (!a) throw new Error(`no assignment ${assignment}`)
  const pages = packetPages(student, assignment)
  const byId = new Map(pages.map((p) => [p.id, p]))
  const ordered = pageIds.map((id) => byId.get(id)).filter((p): p is Page => !!p)
  if (ordered.length !== pages.length) throw new Error('the order must name every page of the packet once')
  const temp: Array<{ p: Page; tmp: string; dest: string; page: number; side: Side }> = []
  ordered.forEach((p, i) => {
    const page = a.twoSided ? Math.floor(i / 2) + 1 : i + 1
    const side: Side = a.twoSided ? (i % 2 === 0 ? 'a' : 'b') : 'a'
    const ext = path.extname(p.filePath) || '.jpg'
    const dest = path.join(ARCHIVE_DIR, assignment, student, `${page}${side}${ext}`)
    const tmp = path.join(ARCHIVE_DIR, assignment, student, `.${p.id}.moving${ext}`)
    temp.push({ p, tmp, dest, page, side })
  })
  for (const t of temp) fs.renameSync(abs(t.p.filePath), t.tmp)
  for (const t of temp) {
    fs.renameSync(t.tmp, t.dest)
    updatePage(t.p.id, { page: t.page, side: t.side, filePath: rel(t.dest) })
  }
  const packet = refreshPacket(student, assignment, new Date().toISOString())
  broadcast('packet', packet)
  return packetPages(student, assignment)
}

// A page filed under the wrong student goes back to review, to be filed again.
export function unfilePage(pageId: number): Page {
  const p = getPage(pageId)
  if (!p) throw new Error('page not found')
  if (p.status !== 'filed' || !p.student || !p.assignment) throw new Error('page is not filed')
  const dest = path.join(HOLDING_DIR, `${p.seq}-${p.sourceName}`)
  fs.renameSync(abs(p.filePath), dest)
  updatePage(pageId, { status: 'review', filePath: rel(dest), reason: `Sent back from ${p.student} · ${p.assignment}`, filedFrom: null, decoded: null, student: null, assignment: null, page: null, side: null })
  if (packetPages(p.student, p.assignment).length === 0) deletePacket(p.student, p.assignment)
  else refreshPacket(p.student, p.assignment, new Date().toISOString())
  const updated = getPage(pageId)!
  broadcast('review', updated)
  return updated
}

export function skipAllInReview(notWork = false): number {
  const pages = reviewPages()
  for (const p of pages) updatePage(p.id, { status: notWork ? 'not_work' : 'skipped' })
  if (pages.length) broadcast('review', { skippedAll: pages.length })
  return pages.length
}

// Packets that stopped arriving --------------------------------------------

// Only once a side that was waited for has arrived: a packet holding nothing
// but pages that stay with the student has not started.
export function stalePackets(now = Date.now()) {
  const cutoff = now - INCOMPLETE_AFTER_MIN * 60_000
  return openPackets().filter((p) => p.sides > 0 && Date.parse(p.lastAt) < cutoff)
}

// Every packet that stopped arriving is filed as it is, in one go: the sides
// that came stay filed, a side that turns up later still joins, and nothing
// waits in review for it any more.
export function closeStalePackets(now = Date.now()): number {
  const stale = stalePackets(now)
  for (const p of stale) closePacketIncomplete(p.student, p.assignment)
  if (stale.length) broadcast('review', { closedPackets: stale.length })
  return stale.length
}

function duplicateOf(ref: PageRef): Page | undefined {
  return packetPages(ref.student, ref.assignment).find((p) => p.page === ref.page && p.side === ref.side)
}

// Paths ------------------------------------------------------------------

function archivePath(ref: PageRef, sourceName: string) {
  const ext = path.extname(sourceName).toLowerCase() || '.jpg'
  return path.join(ARCHIVE_DIR, ref.assignment, ref.student, `${ref.page}${ref.side}${ext}`)
}
export function rel(absPath: string) {
  return path.relative(DATA_DIR, absPath).split(path.sep).join('/')
}
export function abs(relPath: string) {
  return path.join(DATA_DIR, ...relPath.split('/'))
}
export type { Side }
