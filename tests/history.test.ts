import { describe, expect, it } from 'vitest'
import { historyText, latestLevels, skillTimeline, type HistoryEntry } from '../server/history.js'

const entries: HistoryEntry[] = [
  {
    assignment: 'W22', title: 'Weekend Writing', at: '2026-10-17T01:00:00.000Z', score: 3, scoreOf: 4,
    skills: [{ name: 'subject-verb agreement', level: 'developing', evidence: 'she goes' }, { name: 'past tense', level: 'not_yet', evidence: 'I go yesterday' }],
    domains: [{ domain: 'Ideas and content', level: 3, note: 'two clear events' }],
    corrections: [{ wrote: 'I go yesterday', better: 'I went yesterday', why: 'yesterday needs the past' }],
    feedback: 'Minji, "she goes" is right every time now.\nNext time, try the past tense: went, not go.',
    progress: null,
  },
  {
    assignment: 'W21', title: 'Long A Hunt', at: '2026-10-03T01:00:00.000Z', score: null, scoreOf: null,
    skills: [{ name: 'subject-verb agreement', level: 'not_yet', evidence: 'she go' }, { name: 'long vowels', level: 'secure', evidence: 'rain, play' }],
    domains: [], corrections: [], feedback: null, progress: null,
  },
]

describe('a student\'s earlier work', () => {
  it('lines each skill up oldest to newest', () => {
    const t = skillTimeline(entries)
    expect(t.get('subject-verb agreement')!.map((r) => r.level)).toEqual(['not_yet', 'developing'])
    expect(t.get('long vowels')!.map((r) => r.assignment)).toEqual(['W21'])
    expect(latestLevels(entries).get('subject-verb agreement')).toBe('developing')
    expect(latestLevels(entries).get('past tense')).toBe('not_yet')
  })
  it('becomes prompt text with the timeline, the recent details and the last note', () => {
    const text = historyText(entries, 'Minji')
    expect(text).toMatch(/^Earlier work by Minji, newest first/)
    expect(text).toContain('where to look, not what to find')
    expect(text).toContain('- subject-verb agreement: not yet (W21, 3 Oct) → developing (W22, 17 Oct)')
    expect(text).toContain('- long vowels: secure (W21, 3 Oct)')
    expect(text).toContain('W22 · Weekend Writing · 17 Oct · scored 3 of 4')
    expect(text).toContain('Domains: Ideas and content 3 (two clear events)')
    expect(text).toContain('Fix-it rows given: "I go yesterday" → "I went yesterday"')
    expect(text).toContain('The note Minji was given: Minji, "she goes" is right every time now. Next time, try the past tense: went, not go.')
    expect(text.indexOf('W22 · Weekend')).toBeLessThan(text.indexOf('W21 · Long A'))
  })
  it('is empty with no earlier work', () => {
    expect(historyText([], 'Minji')).toBe('')
  })
})
