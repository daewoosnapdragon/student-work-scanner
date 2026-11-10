/**
 * The analysis step: a student's scanned pages go to Claude with the
 * assignment's context, and back come the teacher's notes, a note to the
 * student, a score when one applies, and the skills the work shows. Runs
 * one packet at a time in the background; the page follows along over the
 * event stream. Nothing runs without an API key in Settings.
 */
import Anthropic from '@anthropic-ai/sdk'
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod'
import { z } from 'zod'
import {
  getAssignment, getMeta, getPacket, getStudent, packetPages, packetsForAssignment, setAssignmentAnalysis, setMeta,
  setPacketFeedback, setPacketNote, setClaudeScore, replaceSkills, markAnalysed, replaceDomains, setPacketCorrections, setPacketCriteria, setPacketProgress,
} from './db.js'
import { calibrationText } from './agreement.js'
import { historyText, latestLevels, studentHistory } from './history.js'
import { annotationsForPage, anchorsForAssignment, domainsForAssignment } from './db.js'
import { annotationsText, pageJpeg } from './marks.js'
import { abs } from './pipeline.js'
import { broadcast } from './events.js'
import { sideLabel } from './codes.js'
import { parseProgress, parseRubric, SKILL_LEVEL_LABEL, type Assignment, type Packet, type Rubric, type Student } from '../shared/types.js'
import { anchorsText, rubricText, type AnchorForPrompt } from './analysis.js'
import { canonicalSkill, saveSkillVocabulary, skillVocabulary, skillVocabularyText } from './skills.js'
import { skillListForPrompt, type SkillDef } from '../shared/skills.js'

export const DEFAULT_MODEL = 'claude-opus-5-5'
export const DEFAULT_DOMAINS = ['Ideas and content', 'Organization', 'Language: grammar and vocabulary', 'Spelling and punctuation', 'Task completion']
// Dropped 2026-11-09: it rated the scan as much as the child. A saved list that still has it loses it.
const RETIRED_DOMAINS = new Set(['handwriting and presentation'])
export const LEVELS: Record<number, string> = { 4: 'Strong', 3: 'Secure', 2: 'Developing', 1: 'Beginning' }

/** The domains every analysis rates, one per line in Settings. */
export function domainList(): string[] {
  const raw = getMeta('domains')
  const list = (raw ? raw.split('\n').map((d) => d.trim()).filter(Boolean) : DEFAULT_DOMAINS).filter((d) => !RETIRED_DOMAINS.has(d.toLowerCase()))
  return list.length ? list : DEFAULT_DOMAINS
}

export interface Settings {
  hasKey: boolean
  keyHint: string | null
  model: string
  auto: boolean
  /** The teacher's standing notes: who the class is, what she is working on, how she likes feedback written. */
  context: string
  /** The domains each packet is rated on, 1 to 4. */
  domains: string[]
  /** The skill vocabulary as Settings text: # Group lines, then "name | alias, alias" lines. */
  skills: string
}

export function getSettings(): Settings {
  const key = apiKey()
  return {
    hasKey: !!key,
    keyHint: key ? `${key.slice(0, 10)}…${key.slice(-4)}` : null,
    model: getMeta('model') ?? DEFAULT_MODEL,
    auto: getMeta('autoAnalyse') === '1',
    context: getMeta('teacherContext') ?? '',
    domains: domainList(),
    skills: skillVocabularyText(),
  }
}
export function saveSettings(s: { apiKey?: string | null; model?: string; auto?: boolean; context?: string; domains?: string[]; skills?: string }) {
  if (s.domains !== undefined) setMeta('domains', s.domains.map((d) => d.trim()).filter(Boolean).join('\n'))
  if (s.skills !== undefined) saveSkillVocabulary(s.skills)
  if (s.apiKey !== undefined) setMeta('anthropicApiKey', s.apiKey?.trim() ?? '')
  if (s.model !== undefined) setMeta('model', s.model.trim() || DEFAULT_MODEL)
  if (s.auto !== undefined) setMeta('autoAnalyse', s.auto ? '1' : '0')
  if (s.context !== undefined) setMeta('teacherContext', s.context)
}
function apiKey(): string | null {
  return getMeta('anthropicApiKey') || process.env.ANTHROPIC_API_KEY || null
}
function client(): Anthropic {
  const key = apiKey()
  if (!key) throw new Error('No API key. Add one in Settings.')
  return new Anthropic({ apiKey: key })
}

// What comes back for one packet.
const Level = z.enum(['secure', 'developing', 'not_yet'])
const PacketResult = z.object({
  teacher: z.string().describe("Notes for the teacher: 3 to 6 sentences on what the work shows. What is secure, what is developing, one specific thing to teach or praise next. Quote the student's actual writing where it helps."),
  feedback: z.string().describe('A note the student reads themselves, pitched at their grade. 3 to 5 short sentences, warm and specific: one thing they did well, quoting their own words, and one thing to try next time. First name only. No scores.'),
  score: z.number().nullable().describe('A score for the work if it can be scored (right answers, a rubric level); null when it cannot.'),
  scoreOf: z.number().nullable().describe('What the score is out of; null when no score.'),
  // The skill names are an enum built per request from the vocabulary; see packetSchema.
  skills: z.array(z.object({
    name: z.string(),
    level: Level,
    evidence: z.string().describe('One phrase from the page that shows it.'),
  })).describe('The 3 to 7 skills this work gives evidence for.'),
  incomplete: z.boolean().describe('True when a side is blank or the work stops partway.'),
  // The skill names here are an enum per request too; see packetSchema.
  progress: z.array(z.object({ skill: z.string(), from: Level.nullable(), to: Level, note: z.string() })),
  followedUp: z.string().nullable().describe('Whether the child did what their last note asked them to try next time: one sentence, quoting this page. Null when no earlier note was given, or the page gives no evidence either way.'),
  corrections: z.array(z.object({
    wrote: z.string().describe("Exactly what the student wrote, copied from the page, a few words at most."),
    better: z.string().describe('The corrected words.'),
    why: z.string().describe('The rule in one short sentence a child understands: "after did, the verb stays plain".'),
  })).describe('The fix-it table on the student\'s slip: the 3 to 6 mistakes most worth fixing, only ones actually on the page, the most important first. Up to 3 for grades 1 and 2. Spelling, grammar, punctuation, capitals, word choice. Empty if the work has nothing worth correcting.'),
})
export type PacketResultT = z.infer<typeof PacketResult> & { domains: Array<{ domain: string; level: number; note: string }>; criteria: Array<{ criterion: string; met: boolean; evidence: string }> }

// The domains, criteria and skill names are the teacher's own, so the schema is built per request.
function packetSchema(domains: string[], rubric: Rubric, skills: SkillDef[]) {
  const skillNames = skills.map((s) => s.name) as [string, ...string[]]
  const criteria = rubric.criteria.length
    ? z.array(z.object({ criterion: z.enum(rubric.criteria as [string, ...string[]]), met: z.boolean(), evidence: z.string().describe('What on the page shows it, or what is missing.') })).describe('Every criterion in the list, in order.')
    : rubric.propose
      ? z.array(z.object({ criterion: z.string().describe('A success criterion the worksheet itself asks for, in a few words.'), met: z.boolean(), evidence: z.string() })).describe('3 to 5 criteria worked out from what the worksheet asks for, the same ones for every student.')
      : z.array(z.object({ criterion: z.string(), met: z.boolean(), evidence: z.string() })).max(0).describe('Empty: no criteria for this task.')
  return PacketResult.extend({
    skills: z.array(z.object({
      name: z.enum(skillNames).describe('A name from the skill list, exactly as written there. Pick the closest; never invent a name.'),
      level: Level,
      evidence: z.string().describe('One phrase from the page that shows it.'),
    })).describe('The 3 to 7 skills this work gives the clearest evidence for, from the skill list. The ones in the teacher\'s focus first, when the page shows them.'),
    progress: z.array(z.object({
      skill: z.enum(skillNames).describe('A skill from the earlier work, by its name in the list.'),
      from: Level.nullable().describe('Its level in the most recent earlier work that recorded it; null if the earlier work never recorded this skill.'),
      to: Level.describe('Its level on these pages.'),
      note: z.string().describe('One phrase from these pages that shows the level now; say "held" or "slipped" or "moved up" in a word or two first.'),
    })).describe('Every skill from the earlier work that these pages give evidence on, whether it moved or held. Empty when no earlier work was given, or nothing it recorded shows here. Never report movement the page does not show.'),
    criteria,
    domains: domains.length
      ? z.array(z.object({
          domain: z.enum(domains as [string, ...string[]]),
          level: z.number().int().min(1).max(4).describe('4 strong, 3 secure, 2 developing, 1 beginning. Judge against what this grade can be expected to do.'),
          note: z.string().describe('One short phrase saying why, from the page.'),
        })).describe('One entry for every domain in the list, in order.')
      : z.array(z.object({ domain: z.string(), level: z.number(), note: z.string() })).max(0).describe('Empty: no domains for this task.'),
  })
}
export type PacketResultFull = z.infer<ReturnType<typeof packetSchema>>

const ClassResult = z.object({
  summary: z.string().describe('What the whole class shows: 2 to 4 short paragraphs. Shared strengths, the common gaps with how many students show each, and what to teach next, concretely.'),
  noticing: z.string().describe('One sentence about one student worth the teacher\'s attention this week: a change, a jump, or a worry. Name the student.'),
})

// The page as Claude sees it: with the teacher's comment boxes drawn on when there are any.
async function pageImage(file: string, marks: Parameters<typeof pageJpeg>[1] = [], width = 1568): Promise<Anthropic.ImageBlockParam> {
  const { buffer } = await pageJpeg(file, marks, width, 80)
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buffer.toString('base64') } }
}

function system(a: Assignment, rubric: Rubric, domains: string[], skills: SkillDef[] = skillVocabulary(), anchors: AnchorForPrompt[] = []): string {
  const ctx = getMeta('teacherContext')?.trim()
  return [
    'You read scanned worksheets from an elementary English class in Korea (students learning English) and write what each one shows, for the teacher and for the student.',
    'Be concrete and honest. Quote the handwriting rather than describing it vaguely. Never invent work that is not on the page. If a side is blank or unreadable, say so.',
    'The teacher\'s note is professional and brief. The student\'s note is specific and addresses the child by first name; it names one real strength with their own words quoted, and one thing to try next time; it never carries a score, mark or level.',
    `This assignment: "${a.title}" (${a.code}), ${a.klass}${a.grade != null ? `, grade ${a.grade}` : ''}${a.tags ? `, on ${a.tags}` : ''}. ${a.sheets} sheet${a.sheets === 1 ? '' : 's'}${a.twoSided ? ', both sides' : ''}.${a.notes ? ` Notes: ${a.notes}` : ''}`,
    rubricText(rubric, a.grade, domains),
    anchors.length ? anchorsText(anchors, rubric) + ' The anchor packets\' pages come first in the message, each under a line naming its score; the packet to assess comes after them.' : '',
    calibrationText(a.code),
    `Skills are named only from this list, so the same skill has the same name on every assignment and a child's progress can be followed (group: names):\n${skillListForPrompt(skills)}`,
    'Where the teacher has marked a page, the marks are listed after it and drawn on it as thin numbered boxes; they are the teacher\'s, not the child\'s work, and they are the ground truth. A "fix" mark names a mistake that goes in the fix-it table before anything you found yourself, in the teacher\'s terms. A "praise" mark names a strength the student\'s note quotes. A "note" is context to use, and a question in one is for you to answer in the teacher\'s note.',
    'When earlier work by the same child is given: read the new pages on their own first and judge them as they are; only then compare. The earlier work says where to look, not what to find. If a skill the child was weak on has clearly moved up, the note to the student opens with that, naming the exact thing they did, before anything else, and the teacher\'s note says what moved and what did not. If the last note asked the child to try something, say whether they did. Never claim progress the pages do not show.',
    ctx ? `About the class and how the teacher works: ${ctx}` : '',
  ].filter(Boolean).join('\n\n')
}
/** The domains this assignment's rubric keeps, in Settings order. */
export function domainsFor(rubric: Rubric): string[] {
  const all = domainList()
  return rubric.domains && rubric.domains.length ? all.filter((d) => rubric.domains!.includes(d)) : all
}

/** The assignment's anchors with names and the teacher's domain ratings, leaving out the packet being assessed. */
export function anchorsFor(assignment: string, except?: string): AnchorForPrompt[] {
  const ratings = domainsForAssignment(assignment)
  return anchorsForAssignment(assignment).filter((an) => an.student !== except && packetPages(an.student, assignment).length > 0).map((an) => ({
    student: an.student,
    name: getStudent(an.student)?.name ?? an.student,
    score: an.score,
    scoreOf: an.scoreOf,
    note: an.note,
    domains: ratings.filter((r) => r.student === an.student).map((r) => ({ domain: r.domain, level: r.level })),
  }))
}

export async function analysePacket(student: string, assignment: string): Promise<PacketResultT> {
  const a = getAssignment(assignment)
  const s = getStudent(student)
  const pk = getPacket(student, assignment)
  if (!a || !s || !pk) throw new Error('no such packet')
  const pages = packetPages(student, assignment)
  if (!pages.length) throw new Error('no pages filed')
  const first = s.name.replace(/\s*\(([^)]*)\)\s*$/, (_m, nick) => ` (${nick})`)
  const content: Anthropic.ContentBlockParam[] = []
  // The anchors first, the same for every packet of the assignment, so the API caches them across the run.
  const anchors = anchorsFor(assignment, student)
  for (const an of anchors) {
    content.push({ type: 'text', text: `Anchor: ${an.name}'s packet, scored ${an.score} of ${an.scoreOf ?? 4} by the teacher${an.note ? ` (${an.note})` : ''}:` })
    for (const p of packetPages(an.student, assignment)) {
      content.push({ type: 'text', text: `${sideLabel(p.page ?? 1, p.side ?? 'a')}:` })
      content.push(await pageImage(abs(p.filePath), [], 1200))
    }
  }
  if (anchors.length) {
    content.push({ type: 'text', text: 'End of the anchors. The packet to assess follows.', cache_control: { type: 'ephemeral' } })
  }
  for (const p of pages) {
    const side = sideLabel(p.page ?? 1, p.side ?? 'a')
    const marks = annotationsForPage(p.id)
    content.push({ type: 'text', text: `${side}:` })
    content.push(await pageImage(abs(p.filePath), marks))
    if (marks.length) content.push({ type: 'text', text: annotationsText(marks, side) })
  }
  const history = studentHistory(student, assignment)
  const firstName = (/\(([^)]+)\)\s*$/.exec(s.name)?.[1] ?? s.name.split(/\s+/)[0]).trim()
  const past = historyText(history, firstName)
  content.push({ type: 'text', text: `These are ${first}'s pages (code ${s.code}${s.grade != null ? `, grade ${s.grade}` : ''}), in order. The English name in brackets, if any, is what the child goes by in class; use it in the feedback. Write the teacher's notes, the student's note, a score if the work can be scored, and the skills shown.${past ? ' Then, against the earlier work below, say which of its skills these pages show and where each stands now.' : ' This is the first work of theirs on record, so there is no earlier work to compare with.'}` })
  if (past) content.push({ type: 'text', text: past })
  const rubric = parseRubric(a.rubric)
  const domains = domainsFor(rubric)
  const skills = skillVocabulary()
  const res = await client().messages.parse({
    model: getMeta('model') ?? DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'high', format: zodOutputFormat(packetSchema(domains, rubric, skills)) },
    // The system text is the same for every packet of the assignment: cached too.
    system: [{ type: 'text', text: system(a, rubric, domains, skills, anchors), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content }],
  })
  if (res.stop_reason === 'refusal') throw new Error(`Claude declined to read this packet${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ''}`)
  const out = res.parsed_output
  if (!out) throw new Error('Claude answered in a shape that could not be read; try again')
  const scored = rubric.scoring === 'none' ? { score: null, scoreOf: null } : rubric.scoring === 'outOf' && rubric.scoreOf ? { score: out.score, scoreOf: rubric.scoreOf } : { score: out.score, scoreOf: out.score == null ? null : 4 }
  setPacketNote(student, assignment, out.teacher)
  setClaudeScore(student, assignment, scored.score, scored.scoreOf)
  setPacketFeedback(student, assignment, out.feedback)
  setPacketCorrections(student, assignment, out.corrections.slice(0, Math.min(rubric.fixitMax, (a.grade ?? s.grade ?? 3) <= 2 ? 3 : 6)))
  setPacketCriteria(student, assignment, out.criteria.map((c) => ({ ...c, evidence: c.evidence || null })))
  replaceSkills(student, assignment, out.skills.map((k) => ({ ...k, name: canonicalSkill(k.name).name, at: pk.lastAt })))
  // The earlier level comes from our own records when Claude leaves it null but we have one.
  const was = latestLevels(history)
  setPacketProgress(student, assignment, history.length ? {
    items: out.progress.map((i) => { const name = canonicalSkill(i.skill).name; return { skill: name, from: i.from ?? was.get(name) ?? null, to: i.to, note: i.note || null } }),
    followedUp: out.followedUp,
  } : null)
  replaceDomains(student, assignment, out.domains, pk.lastAt, 'claude')
  markAnalysed(student, assignment)
  broadcast('packet', getPacket(student, assignment))
  return out
}

export async function analyseClass(assignment: string): Promise<z.infer<typeof ClassResult>> {
  const a = getAssignment(assignment)
  if (!a) throw new Error('no such assignment')
  const packets = packetsForAssignment(assignment).filter((p) => p.note)
  if (!packets.length) throw new Error('no analysed packets yet')
  const lines = packets.map((p) => {
    const s = getStudent(p.student)
    const pr = parseProgress(p.progress)
    const moved = pr?.items.filter((i) => i.from && i.from !== i.to).map((i) => `${i.skill} ${SKILL_LEVEL_LABEL[i.from!]} → ${SKILL_LEVEL_LABEL[i.to]}`) ?? []
    const extra = [moved.length ? `Since earlier work: ${moved.join('; ')}.` : '', pr?.followedUp ? `Follow-up: ${pr.followedUp}` : ''].filter(Boolean).join(' ')
    return `### ${s?.name ?? p.student} (${p.student})${p.score != null ? ` · ${p.score}/${p.scoreOf ?? '?'}` : ''}\n${p.note}${extra ? `\n${extra}` : ''}`
  })
  const rubric = parseRubric(a.rubric)
  const res = await client().messages.parse({
    model: getMeta('model') ?? DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(ClassResult) },
    system: system(a, rubric, domainsFor(rubric)),
    messages: [{ role: 'user', content: `Here are the teacher's notes on each student's work, from reading the pages, with what moved since their earlier work where there is any. Write what the whole class shows and what to teach next, and name one student worth noticing: a jump or a slip since earlier work counts for a lot.\n\n${lines.join('\n\n')}` }],
  })
  if (res.stop_reason === 'refusal') throw new Error('Claude declined to summarise this class')
  const out = res.parsed_output
  if (!out) throw new Error('Claude answered in a shape that could not be read; try again')
  setAssignmentAnalysis(assignment, out.summary)
  setMeta(`noticing:${assignment}`, JSON.stringify({ text: out.noticing, at: new Date().toISOString() }))
  broadcast('status', { analysed: assignment })
  return out
}

// A small request that proves the key works and names the model.
export async function testKey(): Promise<{ ok: boolean; model: string; message: string }> {
  const model = getMeta('model') ?? DEFAULT_MODEL
  try {
    const r = await client().messages.create({ model, max_tokens: 64, messages: [{ role: 'user', content: 'Say "ready" and nothing else.' }] })
    const text = r.content.find((b): b is Anthropic.TextBlock => b.type === 'text')?.text ?? ''
    return { ok: true, model: r.model, message: text.trim() || 'ready' }
  } catch (err) {
    return { ok: false, model, message: describe(err) }
  }
}

export function describe(err: unknown): string {
  if (err instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in Settings.'
  if (err instanceof Anthropic.PermissionDeniedError) return 'This key is not allowed to use that model.'
  if (err instanceof Anthropic.NotFoundError) return 'That model name was not found. Check the model in Settings.'
  if (err instanceof Anthropic.RateLimitError) return 'Rate limited by the API; it will be tried again shortly.'
  if (err instanceof Anthropic.APIConnectionError) return 'Could not reach the Claude API. Is the computer online?'
  if (err instanceof Anthropic.APIError) return `Claude API error ${err.status}: ${err.message}`
  return err instanceof Error ? err.message : String(err)
}

// ---- the queue: one packet at a time, then the class when its run is done ----

export interface Job { assignment: string; student: string | null; state: 'waiting' | 'running' | 'done' | 'failed'; error?: string; at: string }
const queue: Job[] = []
const recent: Job[] = []
let running = false

export function queueStatus() {
  return { running, waiting: queue.length, jobs: [...queue, ...recent.slice(-30)] }
}

export function enqueuePacket(assignment: string, student: string) {
  if (queue.some((j) => j.assignment === assignment && j.student === student)) return
  queue.push({ assignment, student, state: 'waiting', at: new Date().toISOString() })
  broadcast('analysis', queueStatus())
  void drain()
}
export function enqueueClass(assignment: string) {
  if (queue.some((j) => j.assignment === assignment && j.student === null)) return
  queue.push({ assignment, student: null, state: 'waiting', at: new Date().toISOString() })
  broadcast('analysis', queueStatus())
  void drain()
}
/** Every packet of an assignment not yet analysed (all of them with `force`), then the class. */
export function enqueueAssignment(assignment: string, force = false): number {
  const packets = packetsForAssignment(assignment).filter((p) => force || !p.analysedAt)
  for (const p of packets) enqueuePacket(assignment, p.student)
  enqueueClass(assignment)
  return packets.length
}

async function drain() {
  if (running) return
  running = true
  while (queue.length) {
    const job = queue[0]
    job.state = 'running'
    broadcast('analysis', queueStatus())
    try {
      if (job.student) await analysePacket(job.student, job.assignment)
      else await analyseClass(job.assignment)
      job.state = 'done'
    } catch (err) {
      job.state = 'failed'
      job.error = describe(err)
      console.error('[analysis] failed', job.assignment, job.student ?? 'class', job.error)
      if (err instanceof Anthropic.RateLimitError) await new Promise((r) => setTimeout(r, 20_000))
    }
    queue.shift()
    recent.push(job)
    broadcast('analysis', queueStatus())
  }
  running = false
}

/** The hook the pipeline calls when a packet completes. */
export function onPacketComplete(packet: Packet) {
  if (getMeta('autoAnalyse') !== '1' || !apiKey()) return
  enqueuePacket(packet.assignment, packet.student)
}

export type { Student }
