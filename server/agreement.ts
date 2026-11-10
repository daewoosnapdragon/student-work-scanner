// How Claude's scores and ratings compare with the teacher's, where the
// teacher has given their own. This is the outside check on the analysis:
// nothing else in the program says how far to trust it. The numbers also go
// back into the prompt as a calibration line when Claude runs high or low.
import { allDomains, allPackets, domainsForAssignment, getStudent, packetsForAssignment } from './db.js'
import type { DomainRating, Packet } from '../shared/types.js'

export interface Pair { student: string; name: string; assignment: string; teacher: number; claude: number }
export interface Stat {
  /** The domain, or 'score'. */
  key: string
  n: number
  /** Share of pairs where both gave the same level. */
  exact: number
  /** Share within one level (one point for scores out of 4). */
  withinOne: number
  /** Claude minus teacher, on average: positive means Claude runs high. */
  meanDiff: number
  /** The pairs that differ, biggest gap first. */
  disagreements: Pair[]
}
export interface Agreement { score: Stat | null; domains: Stat[]; compared: number }

export function stat(key: string, pairs: Pair[]): Stat | null {
  if (!pairs.length) return null
  const diffs = pairs.map((p) => p.claude - p.teacher)
  return {
    key,
    n: pairs.length,
    exact: pairs.filter((p) => p.claude === p.teacher).length / pairs.length,
    withinOne: diffs.filter((d) => Math.abs(d) <= 1).length / pairs.length,
    meanDiff: diffs.reduce((t, d) => t + d, 0) / pairs.length,
    disagreements: pairs.filter((p) => p.claude !== p.teacher).sort((a, b) => Math.abs(b.claude - b.teacher) - Math.abs(a.claude - a.teacher) || a.name.localeCompare(b.name)),
  }
}

/** The pure computation, from packets and ratings. Scores count only where the teacher gave one and Claude's is on record, and only out of 4 when mixing assignments. */
export function agreementStats(packets: Packet[], ratings: DomainRating[], name: (code: string) => string, oneAssignment: boolean): Agreement {
  const scorePairs: Pair[] = packets
    .filter((p) => p.scoreBy === 'teacher' && p.score != null && p.claudeScore != null && (oneAssignment || p.scoreOf === 4))
    .map((p) => ({ student: p.student, name: name(p.student), assignment: p.assignment, teacher: p.score!, claude: p.claudeScore! }))
  const byDomain = new Map<string, Pair[]>()
  for (const r of ratings) {
    if (r.by !== 'teacher' || r.claudeLevel == null) continue
    const list = byDomain.get(r.domain) ?? []
    list.push({ student: r.student, name: name(r.student), assignment: r.assignment, teacher: r.level, claude: r.claudeLevel })
    byDomain.set(r.domain, list)
  }
  const domains = [...byDomain.entries()].map(([k, pairs]) => stat(k, pairs)!).sort((a, b) => b.n - a.n || a.key.localeCompare(b.key))
  const compared = new Set([...scorePairs, ...[...byDomain.values()].flat()].map((p) => `${p.assignment}|${p.student}`)).size
  return { score: stat('score', scorePairs), domains, compared }
}

/** For one assignment, or across every assignment when none is given. */
export function agreementFor(assignment?: string): Agreement {
  const name = (code: string) => getStudent(code)?.name ?? code
  if (assignment) return agreementStats(packetsForAssignment(assignment), domainsForAssignment(assignment), name, true)
  return agreementStats(allPackets(), allDomains(), name, false)
}

/**
 * A line for the prompt when the teacher's ratings show Claude running high
 * or low: the assignment's own numbers when there are enough, else the
 * whole archive's. Empty when there is nothing firm to say.
 */
export function calibrationText(assignment: string): string {
  const own = agreementFor(assignment)
  const all = agreementFor()
  const pick = (k: (a: Agreement) => Stat | null | undefined, minOwn: number, minAll: number) => {
    const o = k(own)
    if (o && o.n >= minOwn) return { s: o, where: 'on this assignment' }
    const a = k(all)
    if (a && a.n >= minAll) return { s: a, where: 'across this class\'s assignments so far' }
    return null
  }
  const lines: string[] = []
  const sc = pick((a) => a.score, 3, 6)
  if (sc && Math.abs(sc.s.meanDiff) >= 0.4) lines.push(`Scores: where the teacher scored the same work, yours ran ${fmtDiff(sc.s.meanDiff)} ${sc.where} (${sc.s.n} packets). Lean the other way.`)
  const domainKeys = new Set([...own.domains, ...all.domains].map((d) => d.key))
  for (const key of domainKeys) {
    const d = pick((a) => a.domains.find((x) => x.key === key), 3, 6)
    if (d && Math.abs(d.s.meanDiff) >= 0.4) lines.push(`${key}: yours ran ${fmtDiff(d.s.meanDiff)} ${d.where} (${d.s.n} ratings).`)
  }
  if (!lines.length) return ''
  return `Calibration against the teacher's own ratings. The teacher's rating is the standard; where yours drifted, correct for it:\n${lines.join('\n')}`
}
function fmtDiff(d: number): string {
  const n = Math.abs(d).toFixed(1).replace(/\.0$/, '')
  return `${n} ${d > 0 ? 'high' : 'low'}`
}
