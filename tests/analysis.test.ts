import { describe, expect, it } from 'vitest'
import { classPrompt, splitClassAnswer, splitStudentSection } from '../server/analysis.js'

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
    expect(r).toEqual({ teacher: 'Just notes.', feedback: null })
  })
  it('keeps the prompt asking for both parts', () => {
    const p = classPrompt({ code: 'W04', title: 'T', klass: 'K', grade: 4, tags: '' }, [{ code: '4S18', name: 'Lee Yoona', pages: 3 }])
    expect(p).toContain('### Teacher')
    expect(p).toContain('### Feedback')
    expect(p).toContain('grade 4')
  })
})
