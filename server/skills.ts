// The skill vocabulary on this computer: the default list unless the teacher
// has edited it in Settings. Every skill written to the database passes
// through here so that stored names are always names from the list.
import { allSkills, getMeta, setMeta, writeSkillRows, type SkillRow } from './db.js'
import { canonicalSkillName, DEFAULT_SKILLS, DEFAULT_SKILLS_TEXT, parseSkillList, skillListText, type SkillDef } from '../shared/skills.js'

let cache: { text: string; defs: SkillDef[] } | null = null

/** The list in force. */
export function skillVocabulary(): SkillDef[] {
  const text = getMeta('skillVocabulary')
  if (text == null) return DEFAULT_SKILLS
  if (!cache || cache.text !== text) {
    const defs = parseSkillList(text)
    cache = { text, defs: defs.length ? defs : DEFAULT_SKILLS }
  }
  return cache.defs
}

/** The list as text for the Settings box. */
export function skillVocabularyText(): string {
  const text = getMeta('skillVocabulary')
  return text == null || !parseSkillList(text).length ? DEFAULT_SKILLS_TEXT : skillListText(parseSkillList(text))
}

/** Saves the Settings text (empty text goes back to the default) and refiles existing skills under the new names. */
export function saveSkillVocabulary(text: string): number {
  const defs = parseSkillList(text)
  setMeta('skillVocabulary', defs.length ? skillListText(defs) : '')
  cache = null
  return renormaliseSkills()
}

export function canonicalSkill(raw: string): { name: string; known: boolean } {
  return canonicalSkillName(raw, skillVocabulary())
}

const SEVERITY: Record<SkillRow['level'], number> = { not_yet: 0, developing: 1, secure: 2 }

/**
 * Rewrites every stored skill name onto the list. Rows that collapse onto the
 * same name keep the lower level (the one a teacher would rather see) and the
 * evidence that goes with it. Returns how many rows changed name.
 */
export function renormaliseSkills(): number {
  const defs = skillVocabulary()
  const rows = allSkills()
  let changed = 0
  const merged = new Map<string, SkillRow>()
  for (const r of rows) {
    const { name } = canonicalSkillName(r.name, defs)
    if (name !== r.name) changed++
    const key = `${r.student}|${r.assignment}|${name}`
    const prev = merged.get(key)
    if (!prev || SEVERITY[r.level] < SEVERITY[prev.level]) merged.set(key, { ...r, name })
  }
  if (changed || merged.size !== rows.length) writeSkillRows([...merged.values()])
  return changed
}
