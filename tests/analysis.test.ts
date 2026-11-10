import { describe, expect, it } from 'vitest'
import { classPrompt, rubricText, splitClassAnswer, splitStudentSection } from '../server/analysis.js'
import { DEFAULT_RUBRIC } from '../shared/types.js'
import { DEFAULT_SKILLS } from '../shared/skills.js'
import { parseCorrectionLines } from '../shared/types.js'

const codes = ['4S18', '4S15', '4M27']

describe('splitting a pasted class answer', () => {
  it('files each heading by code and the class part separately', () => {
    const text = `Here is my read of the set.

## 4S18 Lee Yoona
Secure on sentence boundaries. Developing: past tense.
Teach next: irregular past.

## 4S15 Artrini Phun
Three sides done. Strong detail.

## Class
Most students control capitals now. Past tense is the shared gap.`
    const r = splitClassAnswer(text, codes)
    expect([...r.byStudent.keys()]).toEqual(['4S18', '4S15'])
    expect(r.byStudent.get('4S18')).toMatch(/^Secure on sentence boundaries/)
    expect(r.byStudent.get('4S18')).toMatch(/irregular past\.$/)
    expect(r.klass).toMatch(/^Here is my read of the set\./)
    expect(r.klass).toMatch(/Past tense is the shared gap\.$/)
  })
  it('accepts bold labels and plain lines; a code it does not know starts no section', () => {
    const text = `**4M27 (Kim Ji Yul)**
Neat handwriting, two misspellings.

9Z99 Nobody
Not one of ours, so it stays with the student above.

4S15 Artrini
Good.`
    const r = splitClassAnswer(text, codes)
    expect(r.byStudent.get('4M27')).toMatch(/^Neat handwriting, two misspellings\./)
    expect(r.byStudent.get('4M27')).toContain('9Z99 Nobody')
    expect(r.byStudent.get('4S15')).toBe('Good.')
    expect(r.klass).toBeNull()
  })
  it('keeps a heading line that carries real text', () => {
    const r = splitClassAnswer('## 4S18 Lee Yoona: strong work overall, with three sentences that all begin with capitals and end with full stops.', codes)
    expect(r.byStudent.get('4S18')).toMatch(/strong work overall/)
  })
  it('returns nothing for an empty paste', () => {
    const r = splitClassAnswer('', codes)
    expect(r.byStudent.size).toBe(0)
    expect(r.klass).toBeNull()
  })
})

describe('the prompt', () => {
  it('names the assignment, every student with code and page count, and the answer shape', () => {
    const p = classPrompt({ code: 'W04', title: 'Now vs. In 20 Years', klass: 'Snapdragon', grade: 4, tags: 'writing' }, [{ code: '4S18', name: 'Lee Yoona', pages: 3 }])
    expect(p).toContain('"Now vs. In 20 Years" (W04)')
    expect(p).toContain('- 4S18  Lee Yoona  (3 pages)')
    expect(p).toContain('## 4S18 Lee Yoona')
    expect(p).toContain('## Class')
  })
})

describe('splitting one student section into teacher and feedback parts', () => {
  it('uses ### Teacher and ### Feedback headings', () => {
    const r = splitStudentSection('### Teacher\nSecure on capitals.\nScore 3/4.\n### Feedback\nYoona, your letter has a real voice!\nNext time, try one contrast sentence.')
    expect(r.teacher).toBe('Secure on capitals.\nScore 3/4.')
    expect(r.feedback).toBe('Yoona, your letter has a real voice!\nNext time, try one contrast sentence.')
  })
  it('accepts "For Nipun:" and "Feedback:" with text on the same line', () => {
    const r = splitStudentSection('Strong detail, weak punctuation.\n**For Nipun:** You used every section starter. Try adding question marks.')
    expect(r.teacher).toBe('Strong detail, weak punctuation.')
    expect(r.feedback).toBe('You used every section starter. Try adding question marks.')
  })
  it('is all for the teacher when nothing marks a feedback part', () => {
    const r = splitStudentSection('Just notes.')
    expect(r).toEqual({ teacher: 'Just notes.', feedback: null, domains: [], corrections: [], criteria: [], skills: [] })
  })
  it('keeps the prompt asking for both parts', () => {
    const p = classPrompt({ code: 'W04', title: 'T', klass: 'K', grade: 4, tags: '' }, [{ code: '4S18', name: 'Lee Yoona', pages: 3 }])
    expect(p).toContain('### Teacher')
    expect(p).toContain('### Feedback')
    expect(p).toContain('grade 4')
  })
})

describe('domain ratings in a pasted answer', () => {
  const domains = ['Ideas and content', 'Organization', 'Language: grammar and vocabulary', 'Spelling and punctuation']
  it('reads "- Domain: level — note" lines under a Domains heading, matching loosely', () => {
    const r = splitStudentSection(`### Teacher
Good contrast.
### Feedback
Nipun, lovely voice!
### Domains
- Ideas and content: 3 — real predictions
- **Organization:** 4
- Language: 2 — tense slips
- spelling: 2/4 — were/where`, domains)
    expect(r.teacher).toBe('Good contrast.')
    expect(r.feedback).toBe('Nipun, lovely voice!')
    expect(r.domains).toEqual([
      { domain: 'Ideas and content', level: 3, note: 'real predictions' },
      { domain: 'Organization', level: 4, note: null },
      { domain: 'Language: grammar and vocabulary', level: 2, note: 'tense slips' },
      { domain: 'Spelling and punctuation', level: 2, note: 'were/where' },
    ])
  })
  it('leaves ordinary sentences with colons alone', () => {
    const r = splitStudentSection('Teach next: irregular past tense.', domains)
    expect(r.domains).toEqual([])
    expect(r.teacher).toBe('Teach next: irregular past tense.')
  })
  it('the prompt lists the domains and shows the line shape', () => {
    const p = classPrompt({ code: 'W04', title: 'T', klass: 'K', grade: 4, tags: '' }, [{ code: '4S18', name: 'Lee Yoona', pages: 3 }], domains)
    expect(p).toContain('### Domains')
    expect(p).toContain('- Ideas and content: 3')
  })
})

describe('the fix-it table', () => {
  it('reads arrow lines with and without a why, in several spellings', () => {
    expect(parseCorrectionLines(`- did you became → did you become — after "did", the verb stays plain
* were do you live -> where do you live - "where" asks about a place
ur → our
**rember** => **remember** – two m sounds`)).toEqual([
      { wrote: 'did you became', better: 'did you become', why: 'after "did", the verb stays plain' },
      { wrote: 'were do you live', better: 'where do you live', why: '"where" asks about a place' },
      { wrote: 'ur', better: 'our', why: null },
      { wrote: 'rember', better: 'remember', why: 'two m sounds' },
    ])
  })
  it('comes out of a student section under ### Fix-it, leaving the other parts alone', () => {
    const r = splitStudentSection(`### Teacher
Fine.
### Feedback
Jayana, great middle part!
### Fix-it
- were → where — asks about a place
- i → I — the word I is always a capital`)
    expect(r.feedback).toBe('Jayana, great middle part!')
    expect(r.corrections).toHaveLength(2)
    expect(r.corrections[1]).toEqual({ wrote: 'i', better: 'I', why: 'the word I is always a capital' })
  })
  it('is asked for in the prompt', () => {
    expect(classPrompt({ code: 'W04', title: 'T', klass: 'K', grade: 4, tags: '' }, [{ code: '4S18', name: 'Lee Yoona', pages: 3 }])).toContain('### Fix-it')
  })
})

describe('the rubric', () => {
  it('reads criteria lines as met or not yet, with evidence', () => {
    const r = splitStudentSection(`### Teacher
Fine.
### Criteria
- all four sections filled: met — every box has writing
- a wish for future me: not yet — the letter stops after the questions
- [x] a sign-off: yes
### Fix-it
- ur → our`)
    expect(r.criteria).toEqual([
      { criterion: 'all four sections filled', met: true, evidence: 'every box has writing' },
      { criterion: 'a wish for future me', met: false, evidence: 'the letter stops after the questions' },
      { criterion: 'a sign-off', met: true, evidence: null },
    ])
    expect(r.corrections).toHaveLength(1)
  })
  it('turns the rubric into instructions: criteria, chosen domains, focus, tone, scoring, and never a score in the student note', () => {
    const t = rubricText({ ...DEFAULT_RUBRIC, criteria: ['four sections filled', 'a sign-off'], domains: ['Ideas and content'], domainNotes: { 'Ideas and content': 'a real now-versus-future contrast' }, focus: ['past tense'], tone: 'plain', length: 'short', fixitMax: 3, scoring: 'outOf', scoreOf: 10 }, 4, ['Ideas and content', 'Organization'])
    expect(t).toContain('(1) four sections filled (2) a sign-off')
    expect(t).toContain('Ideas and content (a 4 here: a real now-versus-future contrast)')
    expect(t).not.toContain('Organization')
    expect(t).toContain('concentrate on: past tense')
    expect(t).toContain('plain and direct, 2 to 3 short sentences')
    expect(t).toContain('never mentions a score')
    expect(t).toContain('at most 3 rows')
    expect(t).toContain('out of 10')
  })
  it('with no criteria and propose on, asks Claude to work them out; with scoring off, says so', () => {
    const t = rubricText({ ...DEFAULT_RUBRIC, scoring: 'none' }, 2, ['Ideas and content'])
    expect(t).toContain('work out 3 to 5')
    expect(t).toContain('Do not score')
  })
  it('the prompt carries the rubric and the Criteria section', () => {
    const p = classPrompt({ code: 'W04', title: 'T', klass: 'K', grade: 4, tags: '' }, [{ code: '4S18', name: 'Lee Yoona', pages: 3 }], ['Ideas and content'], { ...DEFAULT_RUBRIC, criteria: ['a sign-off'] })
    expect(p).toContain('### Criteria')
    expect(p).toContain('- a sign-off: met — (the evidence)')
    expect(p).toContain('Never a score, mark or level')
  })
})

describe('skills in a pasted answer', () => {
  it('reads a Skills section and folds the names onto the vocabulary', () => {
    const parts = splitStudentSection(`### Teacher
Good control of sentences.
### Feedback
Nice work, Minji.
### Skills
- Past tense verbs: developing — "she goed home"
- **Capitalization**: secure
- verb agreement: not yet — "he like pizza"
- rhyming couplets: secure
- Past tense: secure — repeated, dropped
`, [], DEFAULT_SKILLS)
    expect(parts.teacher).toBe('Good control of sentences.')
    expect(parts.feedback).toBe('Nice work, Minji.')
    expect(parts.skills).toEqual([
      { name: 'past tense', level: 'developing', evidence: 'she goed home', known: true },
      { name: 'capital letters', level: 'secure', evidence: null, known: true },
      { name: 'subject-verb agreement', level: 'not_yet', evidence: 'he like pizza', known: true },
      { name: 'rhyming couplets', level: 'secure', evidence: null, known: false },
    ])
  })
  it('the copied prompt lists the vocabulary and asks for a Skills part', () => {
    const p = classPrompt({ code: 'W23', title: 'My Weekend', klass: 'Daisy', grade: 3, tags: '' }, [{ code: '3D07', name: 'Kim Minji', pages: 2 }], [], DEFAULT_RUBRIC, DEFAULT_SKILLS)
    expect(p).toContain('Sentences and grammar: complete sentences; subject-verb agreement;')
    expect(p).toContain('### Skills')
    expect(p).toMatch(/"### Fix-it" and "### Skills" inside each/)
  })
  it('without a vocabulary the prompt asks for no skills', () => {
    const p = classPrompt({ code: 'W23', title: 'My Weekend', klass: 'Daisy', grade: 3, tags: '' }, [{ code: '3D07', name: 'Kim Minji', pages: 2 }], [], DEFAULT_RUBRIC)
    expect(p).not.toContain('### Skills')
  })
})
