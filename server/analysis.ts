// Claude's answer about a whole class, pasted back in one piece, split by
// student code. Each student's part starts with a line that carries their
// code (a heading, a bold label, or just the code and a name); whatever
// comes before the first code, or under a heading that says Class, is the
// class's own section.
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
export function classPrompt(a: { code: string; title: string; klass: string; grade: number | null; tags: string }, students: Array<{ code: string; name: string; pages: number }>): string {
  const lines = [
    `Attached is a PDF of scanned student work: "${a.title}" (${a.code}), ${a.klass}${a.grade != null ? ` grade ${a.grade}` : ''}${a.tags ? `, on ${a.tags}` : ''}. Each page has a header with the student's name and code; one student's pages follow each other.`,
    '',
    'Students, in the order they appear:',
    ...students.map((s) => `- ${s.code}  ${s.name}  (${s.pages} page${s.pages === 1 ? '' : 's'})`),
    '',
    'Please read every page and write, for each student, 3 to 6 sentences on what the work shows: what is secure, what is developing, one specific thing to teach or praise next, and a score if the work can be scored. Quote or describe the actual writing where it helps.',
    '',
    'Format the answer exactly like this, so it can be filed by code:',
    '',
    `## ${students[0]?.code ?? '3D07'} ${students[0]?.name ?? 'Student Name'}`,
    '(that student\'s analysis)',
    '',
    '## Class',
    '(what the whole class shows: shared strengths, the common gaps, and what to teach next)',
    '',
    'Use one "## CODE Name" heading per student, every student, in the order above, and the "## Class" heading last.',
  ]
  return lines.join('\n')
}
