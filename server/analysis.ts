// Claude's answer about a whole class, pasted back in one piece, split by
// student code. Each student's part starts with a line that carries their
// code (a heading, a bold label, or just the code and a name); whatever
// comes before the first code, or under a heading that says Class, is the
// class's own section.
export interface StudentParts { teacher: string | null; feedback: string | null; domains: Array<{ domain: string; level: number; note: string | null }> }

// A domain line: "- Ideas and content: 3 — uses the frame well" (the dash, colon and note optional).
const DOMAIN_LINE = /^[-*•]?\s*(?:\*\*)?([^:*]{3,60}?)(?:\*\*)?\s*:(?:\*\*)?\s*(?:\*\*)?\s*([1-4])(?:\s*\/\s*4)?(?:\*\*)?\s*(?:[—–-]|:)?\s*(.*)$/

// Inside one student's section: the part for the teacher and the part written
// to the student, split at a line such as "### Feedback", "**For Nipun:**" or
// "Feedback:". Without such a line the whole section is for the teacher.
const FEEDBACK_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:feedback|for the student|to the student|student feedback|for\s+[A-Za-z][\w .'-]{0,40}|dear\s+[A-Za-z][\w .'-]{0,40})\s*:?\s*(?:\*\*|__)?\s*:?\s*(.*)$/i
const TEACHER_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:teacher|for the teacher|analysis|teacher notes?)\s*:?\s*(?:\*\*|__)?\s*:?\s*(.*)$/i

const DOMAINS_LINE = /^(?:#{1,6}\s*)?(?:\*\*|__)?\s*(?:domains|ratings|rubric)\s*:?\s*(?:\*\*|__)?\s*:?\s*$/i

export function splitStudentSection(body: string, domainNames: string[] = []): StudentParts {
  const lines = body.split('\n')
  const teacher: string[] = []
  const feedback: string[] = []
  const domains: StudentParts['domains'] = []
  let into: 'teacher' | 'feedback' | 'domains' = 'teacher'
  const known = domainNames.map((d) => d.toLowerCase())
  const matchDomain = (name: string): string | null => {
    const n = name.trim().toLowerCase().replace(/[*_]/g, '')
    const i = known.findIndex((k) => k === n || k.startsWith(n) || n.startsWith(k.split(':')[0].trim()) || k.split(/\W+/)[0] === n.split(/\W+/)[0])
    return i >= 0 ? domainNames[i] : null
  }
  for (const raw of lines) {
    const line = raw.trim()
    if (DOMAINS_LINE.test(line)) { into = 'domains'; continue }
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
  return { teacher: t || null, feedback: f || null, domains }
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
export function classPrompt(a: { code: string; title: string; klass: string; grade: number | null; tags: string }, students: Array<{ code: string; name: string; pages: number }>, domains: string[] = []): string {
  const lines = [
    `Attached is a PDF of scanned student work: "${a.title}" (${a.code}), ${a.klass}${a.grade != null ? ` grade ${a.grade}` : ''}${a.tags ? `, on ${a.tags}` : ''}. Each page has a header with the student's name and code; one student's pages follow each other.`,
    '',
    'Students, in the order they appear:',
    ...students.map((s) => `- ${s.code}  ${s.name}  (${s.pages} page${s.pages === 1 ? '' : 's'})`),
    '',
    'Please read every page and write two things for each student.',
    '',
    '1. For the teacher: 3 to 6 sentences on what the work shows. What is secure, what is developing, one specific thing to teach or praise next, and a score if the work can be scored. Quote or describe the actual writing where it helps.',
    `2. For the student: 3 to 5 short sentences the child reads themselves${a.grade != null ? `, pitched at grade ${a.grade}` : ''}. Warm and specific. Name one thing they did well, quoting their own words, and one thing to try next time. No grades or scores in this part. Address them by their first name.`,
    ...(domains.length ? [`3. Ratings, 1 to 4 (4 strong, 3 secure, 2 developing, 1 beginning) against what this grade can be expected to do, one line each with a short reason, for exactly these domains: ${domains.join('; ')}.`] : []),
    '',
    'Format the answer exactly like this, so it can be filed by code:',
    '',
    `## ${students[0]?.code ?? '3D07'} ${students[0]?.name ?? 'Student Name'}`,
    '### Teacher',
    '(the notes for the teacher)',
    '### Feedback',
    '(the note to the student)',
    ...(domains.length ? ['### Domains', ...domains.map((d) => `- ${d}: 3 — (why, in a few words)`)] : []),
    '',
    '## Class',
    '(what the whole class shows: shared strengths, the common gaps, and what to teach next)',
    '',
    `Use one "## CODE Name" heading per student, every student, in the order above, with "### Teacher"${domains.length ? ', "### Feedback" and "### Domains"' : ' and "### Feedback"'} inside each, and the "## Class" heading last.`,
  ]
  return lines.join('\n')
}
