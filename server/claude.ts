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
import sharp from 'sharp'
import {
  getAssignment, getMeta, getPacket, getStudent, packetPages, packetsForAssignment, setAssignmentAnalysis, setMeta,
  setPacketFeedback, setPacketScore, replaceSkills, markAnalysed, replaceDomains, setPacketCorrections, setPacketCriteria,
} from './db.js'
import { abs } from './pipeline.js'
import { broadcast } from './events.js'
import { sideLabel } from './codes.js'
import { parseRubric, type Assignment, type Packet, type Rubric, type Student } from '../shared/types.js'
import { rubricText } from './analysis.js'
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

async function pageImage(file: string): Promise<Anthropic.ImageBlockParam> {
  const buf = await sharp(file, { failOn: 'none' }).rotate().resize({ width: 1568, withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer()
  return { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: buf.toString('base64') } }
}

function system(a: Assignment, rubric: Rubric, domains: string[], skills: SkillDef[] = skillVocabulary()): string {
  const ctx = getMeta('teacherContext')?.trim()
  return [
    'You read scanned worksheets from an elementary English class in Korea (students learning English) and write what each one shows, for the teacher and for the student.',
    'Be concrete and honest. Quote the handwriting rather than describing it vaguely. Never invent work that is not on the page. If a side is blank or unreadable, say so.',
    'The teacher\'s note is professional and brief. The student\'s note is specific and addresses the child by first name; it names one real strength with their own words quoted, and one thing to try next time; it never carries a score, mark or level.',
    `This assignment: "${a.title}" (${a.code}), ${a.klass}${a.grade != null ? `, grade ${a.grade}` : ''}${a.tags ? `, on ${a.tags}` : ''}. ${a.sheets} sheet${a.sheets === 1 ? '' : 's'}${a.twoSided ? ', both sides' : ''}.${a.notes ? ` Notes: ${a.notes}` : ''}`,
    rubricText(rubric, a.grade, domains),
    `Skills are named only from this list, so the same skill has the same name on every assignment and a child's progress can be followed (group: names):\n${skillListForPrompt(skills)}`,
    ctx ? `About the class and how the teacher works: ${ctx}` : '',
  ].filter(Boolean).join('\n\n')
}
/** The domains this assignment's rubric keeps, in Settings order. */
export function domainsFor(rubric: Rubric): string[] {
  const all = domainList()
  return rubric.domains && rubric.domains.length ? all.filter((d) => rubric.domains!.includes(d)) : all
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
  for (const p of pages) {
    content.push({ type: 'text', text: `${sideLabel(p.page ?? 1, p.side ?? 'a')}:` })
    content.push(await pageImage(abs(p.filePath)))
  }
  content.push({ type: 'text', text: `These are ${first}'s pages (code ${s.code}${s.grade != null ? `, grade ${s.grade}` : ''}), in order. The English name in brackets, if any, is what the child goes by in class; use it in the feedback. Write the teacher's notes, the student's note, a score if the work can be scored, and the skills shown.` })
  const rubric = parseRubric(a.rubric)
  const domains = domainsFor(rubric)
  const skills = skillVocabulary()
  const res = await client().messages.parse({
    model: getMeta('model') ?? DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'high', format: zodOutputFormat(packetSchema(domains, rubric, skills)) },
    system: system(a, rubric, domains, skills),
    messages: [{ role: 'user', content }],
  })
  if (res.stop_reason === 'refusal') throw new Error(`Claude declined to read this packet${res.stop_details?.explanation ? `: ${res.stop_details.explanation}` : ''}`)
  const out = res.parsed_output
  if (!out) throw new Error('Claude answered in a shape that could not be read; try again')
  const scored = rubric.scoring === 'none' ? { score: null, scoreOf: null } : rubric.scoring === 'outOf' && rubric.scoreOf ? { score: out.score, scoreOf: rubric.scoreOf } : { score: out.score, scoreOf: out.score == null ? null : 4 }
  setPacketScore(student, assignment, scored.score, scored.scoreOf, out.teacher)
  setPacketFeedback(student, assignment, out.feedback)
  setPacketCorrections(student, assignment, out.corrections.slice(0, Math.min(rubric.fixitMax, (a.grade ?? s.grade ?? 3) <= 2 ? 3 : 6)))
  setPacketCriteria(student, assignment, out.criteria.map((c) => ({ ...c, evidence: c.evidence || null })))
  replaceSkills(student, assignment, out.skills.map((k) => ({ ...k, name: canonicalSkill(k.name).name, at: pk.lastAt })))
  replaceDomains(student, assignment, out.domains, pk.lastAt)
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
    return `### ${s?.name ?? p.student} (${p.student})${p.score != null ? ` · ${p.score}/${p.scoreOf ?? '?'}` : ''}\n${p.note}`
  })
  const rubric = parseRubric(a.rubric)
  const res = await client().messages.parse({
    model: getMeta('model') ?? DEFAULT_MODEL,
    max_tokens: 16000,
    output_config: { effort: 'medium', format: zodOutputFormat(ClassResult) },
    system: system(a, rubric, domainsFor(rubric)),
    messages: [{ role: 'user', content: `Here are the teacher's notes on each student's work, from reading the pages. Write what the whole class shows and what to teach next, and name one student worth noticing.\n\n${lines.join('\n\n')}` }],
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
