import { describe, expect, it } from 'vitest'
import { DEFAULT_SKILLS, DEFAULT_SKILLS_TEXT, canonicalSkillName, matchSkill, parseSkillList, skillGroups, skillListForPrompt, skillListText } from '../shared/skills.js'

describe('the skill list as text', () => {
  it('parses groups, names and aliases, dropping blanks and repeats', () => {
    const defs = parseSkillList(`# Grammar
Past Tense | -ed, irregular past
past tense | again
plurals

# Spelling
sight words | tricky words, high-frequency words.
`)
    expect(defs).toEqual([
      { name: 'past tense', group: 'Grammar', aliases: ['-ed', 'irregular past'] },
      { name: 'plurals', group: 'Grammar', aliases: [] },
      { name: 'sight words', group: 'Spelling', aliases: ['tricky words', 'high-frequency words'] },
    ])
  })
  it('round-trips the default list', () => {
    expect(parseSkillList(skillListText(DEFAULT_SKILLS))).toEqual(DEFAULT_SKILLS)
    expect(skillListText(parseSkillList(DEFAULT_SKILLS_TEXT))).toBe(DEFAULT_SKILLS_TEXT)
  })
  it('has no duplicate names or aliases across the default list', () => {
    const all = DEFAULT_SKILLS.flatMap((d) => [d.name, ...d.aliases])
    expect(new Set(all).size).toBe(all.length)
  })
  it('groups keep their order for the prompt', () => {
    const g = skillGroups(DEFAULT_SKILLS)
    expect(g[0].group).toBe('Sentences and grammar')
    expect(skillListForPrompt(DEFAULT_SKILLS)).toMatch(/^Sentences and grammar: complete sentences; subject-verb agreement;/)
  })
})

describe('folding a free-text skill onto the list', () => {
  const name = (s: string) => matchSkill(s, DEFAULT_SKILLS)?.name ?? null
  it('matches names and aliases whatever the case and punctuation', () => {
    expect(name('Subject-Verb Agreement')).toBe('subject-verb agreement')
    expect(name('subject verb agreement')).toBe('subject-verb agreement')
    expect(name('verb agreement.')).toBe('subject-verb agreement')
    expect(name('**Past tense**')).toBe('past tense')
    expect(name('Capitalization')).toBe('capital letters')
  })
  it('matches when the words of a name or alias all appear in the text', () => {
    expect(name('capital at sentence start')).toBe('capital letters')
    expect(name('using the past tense correctly')).toBe('past tense')
    expect(name('irregular past tense verbs')).toBe('past tense')
    expect(name('spelling of long vowel sounds')).toBe('long vowels')
    expect(name('writing in complete sentences')).toBe('complete sentences')
    expect(name('question marks at the end of questions')).toBe('question marks')
  })
  it('matches on most words in common when none fits whole', () => {
    expect(name('short vowel')).toBe('short vowels')
    expect(name('plural noun endings')).toBe('plurals')
  })
  it('gives up on something that fits nothing', () => {
    expect(name('counting to twenty')).toBeNull()
    expect(name('')).toBeNull()
  })
  it('keeps an unknown name, tidied, when storing', () => {
    expect(canonicalSkillName('  Rhyming Words. ', DEFAULT_SKILLS)).toEqual({ name: 'rhyming words', known: false })
    expect(canonicalSkillName('She go → agreement', DEFAULT_SKILLS)).toEqual({ name: 'subject-verb agreement', known: true })
  })
})
