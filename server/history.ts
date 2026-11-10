// What we already know about a student when a new packet comes in: the skills,
// ratings, fix-it rows and the note they were given on earlier assignments.
// Goes to Claude with the new pages so that feedback can say what moved, and
// so a child who has been working on something hears about it when it pays off.
import { domainsForStudent, getAssignment, packetsForStudent, skillsForStudent, type DomainRow, type SkillRow } from './db.js'
import { parseCorrections, parseProgress, SKILL_LEVEL_LABEL, type Correction, type Progress, type SkillLevelName } from '../shared/types.js'

export interface HistoryEntry {
  assignment: string
  title: string
  /** When the packet's last page was scanned. */
  at: string
  score: number | null
  scoreOf: number | null
  skills: Array<Pick<SkillRow, 'name' | 'level' | 'evidence'>>
  domains: Array<Pick<DomainRow, 'domain' | 'level' | 'note'>>
  corrections: Correction[]
  /** The note the child was given. */
  feedback: string | null
  progress: Progress | null
}

/** Earlier analysed packets of a student, newest first, leaving out the one being analysed. */
export function studentHistory(student: string, excluding: string): HistoryEntry[] {
  const skills = skillsForStudent(student)
  const domains = domainsForStudent(student)
  return packetsForStudent(student)
    .filter((p) => p.assignment !== excluding && (p.note || p.feedback || skills.some((k) => k.assignment === p.assignment)))
    .sort((a, b) => b.lastAt.localeCompare(a.lastAt))
    .map((p) => ({
      assignment: p.assignment,
      title: getAssignment(p.assignment)?.title ?? p.assignment,
      at: p.lastAt,
      score: p.score,
      scoreOf: p.scoreOf,
      skills: skills.filter((k) => k.assignment === p.assignment).map((k) => ({ name: k.name, level: k.level, evidence: k.evidence })),
      domains: domains.filter((d) => d.assignment === p.assignment).map((d) => ({ domain: d.domain, level: d.level, note: d.note })),
      corrections: parseCorrections(p.corrections),
      feedback: p.feedback,
      progress: parseProgress(p.progress),
    }))
}

/** Each skill's readings oldest to newest, across every entry. */
export function skillTimeline(entries: HistoryEntry[]): Map<string, Array<{ assignment: string; at: string; level: SkillLevelName }>> {
  const out = new Map<string, Array<{ assignment: string; at: string; level: SkillLevelName }>>()
  for (const e of [...entries].sort((a, b) => a.at.localeCompare(b.at))) {
    for (const k of e.skills) {
      const list = out.get(k.name) ?? []
      list.push({ assignment: e.assignment, at: e.at, level: k.level })
      out.set(k.name, list)
    }
  }
  return out
}

/** The latest reading of each skill, for the schema's "from" when nothing in the text names it. */
export function latestLevels(entries: HistoryEntry[]): Map<string, SkillLevelName> {
  const out = new Map<string, SkillLevelName>()
  for (const [name, readings] of skillTimeline(entries)) out.set(name, readings[readings.length - 1].level)
  return out
}

const fmtDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
const lvl = (l: SkillLevelName) => SKILL_LEVEL_LABEL[l]

/**
 * The history as text for the prompt. The newest `detail` entries are given in
 * full; the skill timeline covers everything. Empty string when there is nothing.
 */
export function historyText(entries: HistoryEntry[], firstName: string, detail = 3): string {
  if (!entries.length) return ''
  const lines: string[] = [`Earlier work by ${firstName}, newest first. It says where to look, not what to find: judge the new pages on their own, then compare.`]
  const timeline = skillTimeline(entries)
  if (timeline.size) {
    lines.push('', 'Skills over time:')
    const rows = [...timeline.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    for (const [name, readings] of rows) lines.push(`- ${name}: ${readings.map((r) => `${lvl(r.level)} (${r.assignment}, ${fmtDate(r.at)})`).join(' → ')}`)
  }
  for (const e of entries.slice(0, detail)) {
    lines.push('', `${e.assignment} · ${e.title} · ${fmtDate(e.at)}${e.score != null ? ` · scored ${e.score}${e.scoreOf != null ? ` of ${e.scoreOf}` : ''}` : ''}`)
    if (e.domains.length) lines.push(`Domains: ${e.domains.map((d) => `${d.domain.split(':')[0].trim()} ${d.level}${d.note ? ` (${d.note})` : ''}`).join('; ')}`)
    if (e.corrections.length) lines.push(`Fix-it rows given: ${e.corrections.map((c) => `"${c.wrote}" → "${c.better}"`).join('; ')}`)
    if (e.progress?.followedUp) lines.push(`Follow-up noted then: ${e.progress.followedUp}`)
    if (e.feedback) lines.push(`The note ${firstName} was given: ${e.feedback.replace(/\s*\n+\s*/g, ' ').trim()}`)
  }
  return lines.join('\n')
}
