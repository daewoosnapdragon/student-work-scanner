// The skill vocabulary: the fixed list of names a skill can have, so that the
// same skill is called the same thing on every assignment, by Claude, by the
// teacher's pasted answers, and by Worksheet Studio when it tags a worksheet.
// Without it "subject-verb agreement", "subject verb agreement" and "verbs
// match their subjects" are three skills and a child's progress on one of
// them cannot be followed.
//
// The teacher edits the list in Settings as text, one skill a line:
//
//   # Grammar
//   subject-verb agreement | agreement, she go, verb agreement
//   past tense | -ed, irregular past
//
// A line starting with # names the group the lines under it belong to. After
// the name, an optional | and comma-separated aliases: other things the same
// skill is commonly called, used to fold free text onto the name.

export interface SkillDef {
  /** The canonical name, lowercase, what gets stored. */
  name: string
  group: string
  aliases: string[]
}

export const DEFAULT_SKILLS_TEXT = `# Sentences and grammar
complete sentences | sentence boundaries, full sentences, fragments, run-on sentences, run-ons
subject-verb agreement | agreement, verb agreement, she go, he like, verbs agree
present tense | simple present, present simple
past tense | simple past, -ed, irregular past, past simple
future tense | will, going to
verb forms | verb form, base form after did, infinitive, -ing form, gerund
articles | a and an, a an the, the
plurals | plural -s, plural nouns, irregular plurals
pronouns | he she it, his her, pronoun reference, subject pronouns
prepositions | in on at, preposition
word order | sentence order, syntax, korean word order
questions | question forms, question words, wh- questions, forming questions
negatives | don't doesn't, negation, not
connectives | and but because, conjunctions, linking words, because sentences, so
adjectives and adverbs | describing words, adjectives, adverbs, comparatives
# Spelling
short vowels | short vowel sounds, cvc words
long vowels | long vowel sounds, silent e, magic e, long e, long a, vowel teams
consonant blends and digraphs | blends, digraphs, sh ch th
sight words | high-frequency words, common words, tricky words
spelling patterns | spelling rules, doubling, -ing spelling, y to i
phonetic spelling | spelling by sound, invented spelling, sounding out
# Punctuation and capitals
capital letters | capitals, capital at sentence start, capitalization, capitalisation, proper nouns
full stops | periods, end punctuation, sentence punctuation
question marks | question mark
commas | comma, commas in lists
apostrophes | apostrophe, contractions, possessive
quotation marks | speech marks, dialogue punctuation
# Vocabulary
word choice | vocabulary, precise words, varied vocabulary, topic words
using new words | target vocabulary, words from the unit, unit vocabulary
# Ideas and organisation
ideas and detail | ideas, detail, elaboration, supporting detail, content
staying on topic | on topic, relevance, answering the question
sequencing | order of events, first next then, sequence
paragraphs | paragraphing, topic sentence
beginnings and endings | opening, closing, sign-off, introduction, conclusion
voice and audience | voice, writing for the reader, tone
# Task habits
following instructions | instructions, following the prompt, doing what was asked
completing the task | completion, finished the work, all sections filled
using the frame | sentence frames, sentence starters, model text
checking work | proofreading, self-correction, editing
handwriting legibility | legible handwriting, letter formation, spacing
`

/** Parses the Settings text into definitions. Blank lines and repeats are dropped. */
export function parseSkillList(text: string): SkillDef[] {
  const out: SkillDef[] = []
  const seen = new Set<string>()
  let group = 'Other'
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.trim()
    if (!line) continue
    if (line.startsWith('#')) { group = line.replace(/^#+\s*/, '').trim() || 'Other'; continue }
    const [namePart, aliasPart = ''] = line.split('|', 2)
    const name = tidy(namePart)
    if (!name || seen.has(name)) continue
    seen.add(name)
    const aliases = aliasPart.split(',').map(tidy).filter((a) => a && a !== name)
    out.push({ name, group, aliases: [...new Set(aliases)] })
  }
  return out
}

/** The inverse of parseSkillList: the text the Settings box shows. */
export function skillListText(defs: SkillDef[]): string {
  const lines: string[] = []
  let group: string | null = null
  for (const d of defs) {
    if (d.group !== group) { group = d.group; lines.push(`# ${group}`) }
    lines.push(d.aliases.length ? `${d.name} | ${d.aliases.join(', ')}` : d.name)
  }
  return lines.join('\n') + '\n'
}

export const DEFAULT_SKILLS: SkillDef[] = parseSkillList(DEFAULT_SKILLS_TEXT)

/** Group names in the order they first appear. */
export function skillGroups(defs: SkillDef[]): Array<{ group: string; skills: SkillDef[] }> {
  const groups: Array<{ group: string; skills: SkillDef[] }> = []
  for (const d of defs) {
    const g = groups.find((x) => x.group === d.group)
    if (g) g.skills.push(d)
    else groups.push({ group: d.group, skills: [d] })
  }
  return groups
}

/** Lowercase, straight quotes, single spaces, no trailing punctuation. */
export function tidy(s: string): string {
  return s.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/[*_]/g, '').replace(/\s+/g, ' ').trim().replace(/[.:;,]+$/, '').toLowerCase()
}

const STOP = new Set(['the', 'a', 'an', 'of', 'and', 'or', 'in', 'on', 'at', 'to', 'for', 'with', 'using', 'use', 'uses', 'correct', 'correctly', 'basic', 'simple'])
function tokens(s: string): string[] {
  return tidy(s).replace(/[^a-z0-9' -]/g, ' ').split(/[\s-]+/).map((t) => t.replace(/^'+|'+$/g, '')).filter((t) => t && !STOP.has(t))
}
// "sentences" and "sentence", "capitals" and "capital" are the same word here.
function stem(t: string): string {
  return t.length > 4 ? t.replace(/(ing|es|s)$/, '') : t
}

/**
 * Folds a skill name written any old way onto a name in the list, or null if
 * it fits nothing well enough. Exact name or alias first (ignoring case and
 * punctuation), then the name or alias whose words all appear in the text,
 * then the one that shares most of its words with it.
 */
export function matchSkill(raw: string, defs: SkillDef[]): SkillDef | null {
  const t = tidy(raw)
  if (!t) return null
  for (const d of defs) if (d.name === t || d.aliases.includes(t)) return d
  const want = new Set(tokens(t).map(stem))
  if (!want.size) return null
  let best: { d: SkillDef; score: number } | null = null
  for (const d of defs) {
    for (const label of [d.name, ...d.aliases]) {
      const have = tokens(label).map(stem)
      if (!have.length) continue
      const shared = have.filter((h) => want.has(h)).length
      if (!shared) continue
      // All of the label's words are in the text: a strong match, better the longer the label.
      // Otherwise the share of words in common, on both sides.
      const score = shared === have.length ? 1 + have.length / 10 : (shared / have.length) * (shared / want.size)
      if (score >= 0.5 && (!best || score > best.score)) best = { d, score }
    }
  }
  return best?.d ?? null
}

/** The stored form of a skill name: the list's name when it matches, else the text tidied. */
export function canonicalSkillName(raw: string, defs: SkillDef[]): { name: string; known: boolean } {
  const m = matchSkill(raw, defs)
  return m ? { name: m.name, known: true } : { name: tidy(raw), known: false }
}

/** The list as it is shown to Claude: grouped, names only. */
export function skillListForPrompt(defs: SkillDef[]): string {
  return skillGroups(defs).map((g) => `${g.group}: ${g.skills.map((s) => s.name).join('; ')}`).join('\n')
}
