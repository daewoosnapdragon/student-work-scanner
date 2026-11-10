import { describe, expect, it } from 'vitest'
import { agreementStats, stat } from '../server/agreement.js'
import type { DomainRating, Packet } from '../shared/types.js'

const pk = (student: string, over: Partial<Packet>): Packet => ({ student, assignment: 'W23', sides: 2, expected: 2, complete: 1, closedIncomplete: 0, firstAt: 'x', lastAt: 'x', score: null, scoreOf: null, note: null, feedback: null, analysedAt: null, corrections: null, criteria: null, progress: null, claudeScore: null, scoreBy: null, ...over })
const rt = (student: string, domain: string, level: number, claudeLevel: number | null, by: 'claude' | 'teacher' | null): DomainRating => ({ student, assignment: 'W23', domain, level, note: null, at: 'x', claudeLevel, by })
const name = (c: string) => ({ S1: 'Ara', S2: 'Bomi', S3: 'Chan', S4: 'Dain' }[c] ?? c)

describe('agreement between the teacher and Claude', () => {
  it('counts only packets the teacher scored where Claude\'s score is on record', () => {
    const ag = agreementStats([
      pk('S1', { score: 4, scoreOf: 4, claudeScore: 4, scoreBy: 'teacher' }),
      pk('S2', { score: 2, scoreOf: 4, claudeScore: 3, scoreBy: 'teacher' }),
      pk('S3', { score: 3, scoreOf: 4, claudeScore: 3, scoreBy: 'claude' }), // Claude's own score, no judgement from the teacher
      pk('S4', { score: 1, scoreOf: 4, claudeScore: null, scoreBy: 'teacher' }), // never analysed
    ], [], name, true)
    expect(ag.score).toMatchObject({ key: 'score', n: 2, exact: 0.5, withinOne: 1, meanDiff: 0.5 })
    expect(ag.score!.disagreements).toEqual([{ student: 'S2', name: 'Bomi', assignment: 'W23', teacher: 2, claude: 3 }])
    expect(ag.compared).toBe(2)
  })
  it('compares each domain where the teacher rated by hand, biggest gaps first', () => {
    const ag = agreementStats([], [
      rt('S1', 'Ideas and content', 3, 3, 'teacher'),
      rt('S2', 'Ideas and content', 2, 4, 'teacher'),
      rt('S3', 'Ideas and content', 3, 4, 'teacher'),
      rt('S4', 'Ideas and content', 4, 4, 'claude'), // Claude's alone
      rt('S1', 'Organization', 2, null, 'teacher'), // the teacher rated before any analysis
    ], name, true)
    expect(ag.domains).toHaveLength(1)
    const d = ag.domains[0]
    expect(d).toMatchObject({ key: 'Ideas and content', n: 3, withinOne: 2 / 3 })
    expect(d.exact).toBeCloseTo(1 / 3)
    expect(d.meanDiff).toBeCloseTo(1)
    expect(d.disagreements.map((p) => p.name)).toEqual(['Bomi', 'Chan'])
    expect(ag.compared).toBe(3)
  })
  it('across assignments, scores count only out of 4 so the scales match', () => {
    const ag = agreementStats([
      pk('S1', { assignment: 'W21', score: 7, scoreOf: 10, claudeScore: 9, scoreBy: 'teacher' }),
      pk('S2', { assignment: 'W22', score: 3, scoreOf: 4, claudeScore: 3, scoreBy: 'teacher' }),
    ], [], name, false)
    expect(ag.score).toMatchObject({ n: 1, exact: 1 })
  })
  it('a stat of nothing is null; a negative mean means Claude runs low', () => {
    expect(stat('score', [])).toBeNull()
    expect(stat('x', [{ student: 'S1', name: 'Ara', assignment: 'W23', teacher: 4, claude: 2 }])!.meanDiff).toBe(-2)
  })
})
