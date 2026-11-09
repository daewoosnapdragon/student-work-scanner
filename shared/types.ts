// Types shared by the server and the web app.

export type Side = 'a' | 'b' // a = front, b = back

export interface PageRef {
  student: string // student code, e.g. S07
  assignment: string // assignment code, e.g. W23
  page: number // 1-based sheet number
  side: Side
}

export type PageStatus = 'filed' | 'review' | 'skipped' | 'not_work' | 'replaced'

export interface Student {
  code: string
  name: string
  nameKo: string | null
  klass: string // class name, e.g. Daisy
  grade: number | null
  homeroom: string | null
  active: number
  externalId: string | null // the school system's id for the student, if known
}

export interface Assignment {
  code: string
  title: string
  klass: string
  grade: number | null
  assignedOn: string | null // ISO date
  sheets: number // number of physical sheets
  twoSided: number // 1 if both sides are expected
  tags: string // comma separated
  notes: string | null
  /** Total sides actually printed, when fewer than sheets × 2 (a double-sided packet with an odd page count). */
  sides: number | null
  /** What the class shows: the analysis of the whole set, pasted in or (later) written by the analysis step. */
  analysis: string | null
  /** The rubric the analysis follows, as JSON (see Rubric). */
  rubric: string | null
  createdAt: string
}

export interface Page {
  id: number
  status: PageStatus
  student: string | null
  assignment: string | null
  page: number | null
  side: Side | null
  scannedAt: string // ISO
  seq: number // scan order
  sourceName: string
  filePath: string // relative to the data dir
  thumbPath: string | null
  width: number | null
  height: number | null
  decoded: string | null // raw QR text if any
  reason: string | null // why it is in review
  filedFrom: 'code' | 'review' | null
}

export interface Packet {
  student: string
  assignment: string
  sides: number // sides filed
  expected: number
  complete: number // 1 when sides >= expected or closed as incomplete
  closedIncomplete: number
  firstAt: string
  lastAt: string
  score: number | null
  scoreOf: number | null
  /** The analysis of this student's work on the assignment, for the teacher. */
  note: string | null
  /** Feedback written for the student to read, printed as a slip. */
  feedback: string | null
  /** When the analysis step last read this packet; null if never. */
  analysedAt: string | null
  /** The fix-it table on the student's slip, as JSON: [{ wrote, better, why }]. */
  corrections: string | null
  /** The rubric's criteria checked for this student, as JSON: [{ criterion, met, evidence }]. */
  criteria: string | null
}

/** What the analysis is asked to look for on one assignment. Kept on the assignment as JSON. */
export interface Rubric {
  /** What the task asked for, one line each; each is checked per student. Empty: Claude proposes criteria from the worksheet itself when `propose` is on. */
  criteria: string[]
  propose: boolean
  /** The Settings domains that apply here; null means all of them. */
  domains: string[] | null
  /** What a 4 looks like for this task, per domain. */
  domainNotes: Record<string, string>
  /** What the teacher has been teaching and wants the feedback to concentrate on. */
  focus: string[]
  tone: 'warm' | 'plain' | 'playful'
  length: 'short' | 'standard' | 'full'
  fixitMax: number
  scoring: 'none' | 'holistic4' | 'outOf'
  scoreOf: number | null
}
export const DEFAULT_RUBRIC: Rubric = { criteria: [], propose: true, domains: null, domainNotes: {}, focus: [], tone: 'warm', length: 'standard', fixitMax: 6, scoring: 'holistic4', scoreOf: null }
export function parseRubric(raw: string | null | undefined): Rubric {
  if (!raw) return { ...DEFAULT_RUBRIC }
  try { const v = JSON.parse(raw); return { ...DEFAULT_RUBRIC, ...v, domainNotes: v.domainNotes ?? {}, criteria: Array.isArray(v.criteria) ? v.criteria : [], focus: Array.isArray(v.focus) ? v.focus : [] } } catch { return { ...DEFAULT_RUBRIC } }
}
export interface CriterionResult { criterion: string; met: boolean; evidence: string | null }
export function parseCriteria(raw: string | null | undefined): CriterionResult[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((c) => c && typeof c.criterion === 'string').map((c) => ({ criterion: c.criterion, met: !!c.met, evidence: c.evidence ?? null })) : [] } catch { return [] }
}

export interface Correction { wrote: string; better: string; why: string | null }
export function parseCorrections(raw: string | null | undefined): Correction[] {
  if (!raw) return []
  try { const v = JSON.parse(raw); return Array.isArray(v) ? v.filter((c) => c && typeof c.wrote === 'string' && typeof c.better === 'string').map((c) => ({ wrote: c.wrote, better: c.better, why: c.why ?? null })) : [] } catch { return [] }
}
/** "you wrote → better — why" lines, the shape the teacher types and the pasted answer uses. */
export function parseCorrectionLines(text: string): Correction[] {
  const out: Correction[] = []
  for (const raw of text.split('\n')) {
    const m = /^[-*•]?\s*(.+?)\s*(?:→|->|=>|⇒)\s*(.+?)(?:\s+[—–]\s*(.+)|\s+-\s+(.+))?\s*$/.exec(raw.trim().replace(/\*\*|__/g, ''))
    if (m) out.push({ wrote: m[1].trim().replace(/^["“]|["”]$/g, ''), better: m[2].trim().replace(/^["“]|["”]$/g, ''), why: (m[3] ?? m[4])?.trim() || null })
  }
  return out
}

export interface Guess {
  rank: number
  student: string | null
  studentName: string | null
  assignment: string | null
  page: number | null
  side: Side | null
  why: string
}

export interface ReviewItem {
  kind: 'page' | 'packet'
  pageId: number | null
  student: string | null
  assignment: string | null
  scannedAt: string
  problem: string
  guesses: Guess[]
  waitingSince: string
}

export interface FeedEvent {
  type: 'page' | 'review' | 'packet' | 'status' | 'hello' | 'analysis'
  at: string
  payload: unknown
}
