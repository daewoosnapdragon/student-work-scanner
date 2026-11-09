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
  note: string | null
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
  type: 'page' | 'review' | 'packet' | 'status' | 'hello'
  at: string
  payload: unknown
}
