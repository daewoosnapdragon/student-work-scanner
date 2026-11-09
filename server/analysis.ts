// Claude's answer about a whole class, pasted back in one piece, split by
// student code. Each student's part starts with a line that carries their
// code (a heading, a bold label, or just the code and a name); whatever
// comes before the first code, or under a heading that says Class, is the
// class's own section.
import { parseCorrectionLines, type Correction, type CriterionResult, type Rubric } from '../shared/types.js'

export interface StudentParts { teacher: string | null; feedback: string | null; domains: Array<{ domain: string; level: number; note: string | null }>; corrections: Correction[]; criteria: CriterionResult[] }

// A domain line: "- Ideas and content: 3 — uses the frame well" (the dash, colon and note optional).
const DOMAIN_LINE = /^[-*•]?\s*(?:\*\*)?([^:*]{3,60}?)(?:\*\*)?\s*:(?:\*\*)?\s*(?:\*\*)?\s*([1-4])(?:\s*\/\s*4)?(?:\*\*)?\s*(?:[—–-]|:)?\s*(.*)$/

// Inside one student's section: the part for the teacher and the part written
// to the student, split at a line such as "### Feedback", "**For Nipun:**" or
// "Feedback:". Without such a line the whole section is for the teacher.
const FEEDBACK_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:feedback|for the student|to the student|student feedback|for\s+[A-Za-z][\w .'-]{0,40}|dear\s+[A-Za-z][\w .'-]{0,40})\s*:?\s*(?:\*\*|__)?\s*:?\s*(.*)$/i
const TEACHER_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:teacher|for the teacher|analysis|teacher notes?)\s*:?\s*(?:\*\*|__)?\s*:?\s*(.*)$/i

const DOMAINS_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:domains|ratings|rubric)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i
const FIXIT_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:fix[- ]?it|fix[- ]?it table|corrections|proofreading)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i
const CRITERIA_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:criteria|success criteria|checklist)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i
// "- a sign-off: met — 'Bye, future me'" or "- a wish for future me: not yet"
const CRITERION_ITEM = /^[-*•]?\s*(?:\[([ xX✓✔])\]\s*)?(.+?)\s*:\s*(met|yes|done|✓|✔|not yet|no|missing|✗|×|partly|partial)\b\.?\s*(?:[—–-]\s*(.+))?$/i

export function splitStudentSection(body: string, domainNames: string[] = []): StudentParts {
  const lines = body.split('\n')
  const teacher: string[] = []
  const feedback: string[] = []
  const domains: StudentParts['domains'] = []
  const fixit: string[] = []
  const criteria: CriterionResult[] = []
  let into: 'teacher' | 'feedback' | 'domains' | 'fixit' | 'criteria' = 'teacher'
  const known = domainNames.map((d) => d.toLowerCase())
  const matchDomain = (name: string): string | null => {
    const n = name.trim().toLowerCase().replace(/[*_]/g, '')
    const i = known.findIndex((k) => k === n || k.startsWith(n) || n.startsWith(k.split(':')[0].trim()) || k.split(/\W+/)[0] === n.split(/\W+/)[0])
    return i >= 0 ? domainNames[i] : null
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (DOMAINS_LINE.test(line)) { into = 'domains'; continue }
    if (FIXIT_LINE.test(line)) { into = 'fixit'; continue }
    if (CRITERIA_LINE.test(line)) { into = 'criteria'; continue }
    if (into === 'fixit') { if (line) fixit.push(line); continue }
    if (into === 'criteria') {
      const m = CRITERION_ITEM.exec(line.replace(/\*\*|__/g, ''))
      if (m) criteria.push({ criterion: m[2].trim(), met: /^(met|yes|done|✓|✔)$/i.test(m[3]) || /[xX✓✔]/.test(m[1] ?? ''), evidence: m[4]?.trim() || null })
      continue
    }
    const fb = FEEDBACK_LINE.exec(line)
    if (fb && line.length < 120) { into = 'feedback'; if (fb[1]?.trim()) feedback.push(fb[1].trim()); continue }
    const tc = TEACHER_LINE.exec(line)
    if (tc && line.length < 120) { into = 'teacher'; if (tc[1]?.trim()) teacher.push(tc[1].trim()); continue }
    const dm = DOMAIN_LINE.exec(line)
    if (dm && known.length) {
      const domain = matchDomain(dm[1])
      if (domain) { domains.push({ domain, level: Number(dm[2]), note: dm[3]?.trim() || null }); continue }
    }
    if (into === 'domains') continue   // other text under the domains heading is noise
    ;(into === 'teacher' ? teacher : feedback).push(raw)
  }
  const t = teacher.join('\n').trim(), f = feedback.join('\n').trim()
  return { teacher: t || null, feedback: f || null, domains, corrections: parseCorrectionLines(fixit.join('\n')), criteria }
}

/** The rubric as instructions, shared by the in-app analysis and the copied prompt. */
export function rubricText(r: Rubric, grade: number | null, domains: string[]): string {
  const lines: string[] = []
  if (r.criteria.length) lines.push(`Success criteria for this task, to check one by one for each student (met or not yet, with the evidence): ${r.criteria.map((c, i) => `(${i + 1}) ${c}`).join(' ')}`)
  else if (r.propose) lines.push('No success criteria were set: work out 3 to 5 from what the worksheet itself asks for, and check those for each student.')
  const used = r.domains && r.domains.length ? domains.filter((d) => r.domains!.includes(d)) : domains
  if (used.length) lines.push(`Rate these domains 1 to 4 (4 strong, 3 secure, 2 developing, 1 beginning) against what grade ${grade ?? '?'} can be expected to do: ${used.map((d) => (r.domainNotes[d] ? `${d} (a 4 here: ${r.domainNotes[d]})` : d)).join('; ')}.`)
  if (r.focus.length) lines.push(`The teacher has been teaching, and wants the feedback and the fix-it table to concentrate on: ${r.focus.join(', ')}. Say how each student did on these first.`)
  const tone = { warm: 'warm and encouraging', plain: 'plain and direct', playful: 'playful, with a light touch' }[r.tone]
  const length = { short: '2 to 3 short sentences', standard: '3 to 5 short sentences', full: '5 to 7 sentences' }[r.length]
  lines.push(`The note to the student is ${tone}, ${length}, pitched at grade ${grade ?? '?'}, and never mentions a score, mark or level.`)
  lines.push(`The fix-it table has at most ${r.fixitMax} rows.`)
  lines.push(r.scoring === 'none' ? 'Do not score this work.' : r.scoring === 'outOf' && r.scoreOf ? `Score the work out of ${r.scoreOf} by counting what is right.` : 'Score the work holistically from 1 to 4 (4 fully meets the task), out of 4.')
  return lines.join('\n')
}

export function splitClassAnswer(text: string, codes: string[]): { byStudent: Map<string, string>; klass: string | null } {
  const known = new Set(codes.map((c) => c.toUpperCase()))
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  const byStudent = new Map<string, string>()
  const klassParts: string[] = []
  let current: string | null = null // a code, 'class', or null (preamble)
  let buf: string[] = []
  const flush = () => {
    const body = buf.join('\n').trim()
    buf = []
    if (!body) return
    if (current && current !== 'class') byStudent.set(current, body)
    else klassParts.push(body)
  }
  const codeRe = /\b([A-Z]\d{0,2}[A-Z]\d{2}|\d[A-Z]\d{2}|[A-Z]{1,2}\d{2,3})\b/g
  for (const raw of lines) {
    const line = raw.trim()
    const heading = /^(#{1,6}\s|\*\*|__|\d+[.)]\s|[-*]\s)/.test(line) || line.length <= 60
    let hit: string | null = null
    if (heading) {
      const stripped = line.replace(/^#{1,6}\s*/, '').replace(/^\d+[.)]\s*/, '').replace(/^[-*]\s*/, '').replace(/[*_]/g, '')
      for (const m of stripped.toUpperCase().matchAll(codeRe)) if (known.has(m[1])) { hit = m[1]; break }
      if (!hit && /^(class|whole class|the class|class summary|what the class shows)\b/i.test(stripped)) hit = 'class'
    }
    if (hit) {
      flush()
      current = hit
      // a heading line that is only the code and name is dropped; one that carries text keeps it
      const rest = line.replace(/^#{1,6}\s*/, '').replace(/[*_]/g, '').trim()
      const onlyLabel = rest.length <= 48 || /^(class|whole class|the class|class summary)\b/i.test(rest)
      if (!onlyLabel) buf.push(line)
      continue
    }
    buf.push(raw)
  }
  flush()
  return { byStudent, klass: klassParts.length ? klassParts.join('\n\n') : null }
}

// The prompt to paste into Claude beside the class PDF: the assignment, the
// students in the PDF's order, and the shape the answer should take so it
// can be pasted straight back.
export function classPrompt(a: { code: string; title: string; klass: string; grade: number | null; tags: string }, students: Array<{ code: string; name: string; pages: number }>, domains: string[] = [], rubric?: Rubric): string {
  const used = rubric?.domains && rubric.domains.length ? domains.filter((d) => rubric.domains!.includes(d)) : domains
  const lines = [
    `Attached is a PDF of scanned student work: "${a.title}" (${a.code}), ${a.klass}${a.grade != null ? ` grade ${a.grade}` : ''}${a.tags ? `, on ${a.tags}` : ''}. Each page has a header with the student's name and code; one student's pages follow each other.`,
    '',
    'Students, in the order they appear:',
    ...students.map((s) => `- ${s.code}  ${s.name}  (${s.pages} page${s.pages === 1 ? '' : 's'})`),
    '',
    ...(rubric ? [rubricText(rubric, a.grade, domains), ''] : []),
    'Please read every page and write, for each student:',
    '',
    '1. For the teacher: 3 to 6 sentences on what the work shows. What is secure, what is developing, one specific thing to teach or praise next. Quote or describe the actual writing where it helps.',
    `2. For the student: a note the child reads themselves${a.grade != null ? `, pitched at grade ${a.grade}` : ''}. Specific: one thing they did well, quoting their own words, and one thing to try next time. Never a score, mark or level in this part. Address them by their first name.`,
    `3. Criteria: each success criterion as "- criterion: met" or "- criterion: not yet", with the evidence after a dash.`,
    ...(used.length ? [`4. Ratings, 1 to 4 (4 strong, 3 secure, 2 developing, 1 beginning) against what this grade can be expected to do, one line each with a short reason, for exactly these domains: ${used.join('; ')}.`] : []),
    `${used.length ? 5 : 4}. A fix-it table for the student: the mistakes most worth fixing, only ones actually on the page, most important first, at most ${rubric?.fixitMax ?? (a.grade != null && a.grade <= 2 ? 3 : 6)}. Each line: exactly what they wrote → the corrected words — the rule in one short sentence a child understands.`,
    '',
    'Format the answer exactly like this, so it can be filed by code:',
    '',
    `## ${students[0]?.code ?? '3D07'} ${students[0]?.name ?? 'Student Name'}`,
    '### Teacher',
    '(the notes for the teacher)',
    '### Feedback',
    '(the note to the student)',
    '### Criteria',
    ...(rubric?.criteria.length ? rubric.criteria.map((c) => `- ${c}: met — (the evidence)`) : ['- (a criterion): met — (the evidence)', '- (another): not yet — (what is missing)']),
    ...(used.length ? ['### Domains', ...used.map((d) => `- ${d}: 3 — (why, in a few words)`)] : []),
    '### Fix-it',
    '- did you became → did you become — after "did", the verb stays plain',
    '- were do you live → where do you live — "where" asks about a place',
    '',
    '## Class',
    '(what the whole class shows: shared strengths, the common gaps, and what to teach next)',
    '',
    `Use one "## CODE Name" heading per student, every student, in the order above, with "### Teacher", "### Feedback", "### Criteria"${used.length ? ', "### Domains"' : ''} and "### Fix-it" inside each, and the "## Class" heading last.`,
  ]
  return lines.join('\n')
}
