import type { PileStatus } from '../../../shared/types'

interface PileFacts {
  pages: number
  sheets: number | null
  twoSided: number | null
  status: PileStatus
  filed: number
  toCheck: number
  looseFrom: number
  assignment: string | null
}

const n = (k: number, one: string, many = `${one}s`) => `${k} ${k === 1 ? one : many}`

export function pileLine(p: PileFacts): string {
  const sheets = p.sheets ?? Math.ceil(p.pages / (p.twoSided ? 2 : 1))
  if (p.status === 'done') return `${n(sheets, 'sheet')} · all filed`
  if (p.status === 'checking') return `${n(sheets, 'sheet')} · ${p.filed} filed on their own · ${p.toCheck} to check`
  if (p.status === 'jumbled') return `The backs did not mirror the fronts, so nothing was filed by position; ${n(p.looseFrom, 'page')} went to loose pages.`
  return `${n(p.pages, 'page')} · no code read`
}

export function pileAction(p: PileFacts): 'check' | 'settle' | 'undo' | null {
  if (p.status === 'checking') return 'check'
  if (p.status === 'new') return 'settle'
  if (p.status === 'done' || p.status === 'jumbled') return 'undo'
  return null
}

/** The last segment of a path, with either kind of slash. */
export function folderName(path: string): string {
  const parts = path.split(/[\\/]+/).filter(Boolean)
  return parts[parts.length - 1] ?? path
}
