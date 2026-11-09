import fs from 'node:fs'
import path from 'node:path'
import sharp from 'sharp'
import * as mupdf from 'mupdf'
import { ARCHIVE_DIR, DATA_DIR, HOLDING_DIR, INBOX_DIR, INCOMPLETE_AFTER_MIN, PDF_DPI, THUMBS_DIR } from './config.js'
import { decodePage, makeThumb } from './decode.js'
import { deletePacket, getAssignment, getStudent, hasSide, insertPage, nextSeq, openPackets, packetPages, refreshPacket, reviewPages, updatePage, getPage } from './db.js'
import { broadcast } from './events.js'
import type { Page, PageRef, Side } from '../shared/types.js'
import { shortSide } from './codes.js'

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff', '.webp', '.bmp'])

export function isScanFile(file: string) {
  const ext = path.extname(file).toLowerCase()
  return IMAGE_EXT.has(ext) || ext === '.pdf'
}

// One file from the inbox. A PDF is rendered to one JPEG per page, which are
// returned so the caller can process them next, in page order. An image is
// decoded and filed straight away.
export async function processInboxFile(file: string): Promise<string[]> {
  const ext = path.extname(file).toLowerCase()
  if (ext === '.pdf') return splitPdf(file)
  if (!IMAGE_EXT.has(ext)) return []
  await processImage(file, path.basename(file))
  return []
}

// Renders each PDF page with MuPDF (bundled as WebAssembly, so nothing to
// install) into the inbox as JPEGs named after the PDF, then removes the PDF.
async function splitPdf(file: string): Promise<string[]> {
  const stem = path.basename(file, path.extname(file))
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
    fs.rmSync(file)
    console.log(`[pdf] ${path.basename(file)}: ${n} page${n === 1 ? '' : 's'}`)
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

export async function processImage(file: string, sourceName: string): Promise<Page> {
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
  const problem = ref ? placementProblem(ref) : decoded.text ? `Code read as "${decoded.text}" but it is not one of ours` : 'Code not readable'

  if (ref && !problem) {
    const dest = archivePath(ref, sourceName)
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    fs.renameSync(file, dest)
    const p = insertPage({
      status: 'filed', student: ref.student, assignment: ref.assignment, page: ref.page, side: ref.side, scannedAt: at, seq,
      sourceName, filePath: rel(dest), thumbPath, width: decoded.width, height: decoded.height, decoded: decoded.text, reason: null, filedFrom: 'code',
    })
    const packet = refreshPacket(ref.student, ref.assignment, at)
    broadcast('page', { page: p, packet })
    if (packet.complete) broadcast('packet', packet)
    return p
  }

  const dest = path.join(HOLDING_DIR, `${seq}-${sourceName}`)
  fs.renameSync(file, dest)
  const p = insertPage({
    status: 'review', student: ref?.student ?? null, assignment: ref?.assignment ?? null, page: ref?.page ?? null, side: ref?.side ?? null,
    scannedAt: at, seq, sourceName, filePath: rel(dest), thumbPath, width: decoded.width, height: decoded.height, decoded: decoded.text,
    reason: problem, filedFrom: null,
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
  if (hasSide(ref.student, ref.assignment, ref.page, ref.side)) return `${ref.student} already has ${shortSide(ref.page, ref.side)} of ${ref.assignment} filed; this may be a rescan`
  return null
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
  if (dup) updatePage(dup.id, { status: 'replaced', reason: `replaced by rescan, page ${pageId}` })
  const from = abs(p.filePath)
  const dest = archivePath(ref, p.sourceName)
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  fs.renameSync(from, dest)
  updatePage(pageId, {
    status: 'filed', student: ref.student, assignment: ref.assignment, page: ref.page, side: ref.side, filePath: rel(dest), reason: null, filedFrom: 'review',
  })
  const packet = refreshPacket(ref.student, ref.assignment, p.scannedAt)
  const updated = getPage(pageId)!
  broadcast('page', { page: updated, packet })
  return updated
}

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

export function stalePackets(now = Date.now()) {
  const cutoff = now - INCOMPLETE_AFTER_MIN * 60_000
  return openPackets().filter((p) => Date.parse(p.lastAt) < cutoff)
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
