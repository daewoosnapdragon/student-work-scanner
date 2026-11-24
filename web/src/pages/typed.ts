import type { Student } from '../api'
import { parseLooseCode } from '../../../shared/codeInput'
import type { Side } from '../../../shared/types'

// What the typed label resolves to. "S07 W23 2 back" is read whole; "Minji W23
// 2 back" needs the roster to turn the name into a code, so the name is handed
// back for a search and the rest waits until exactly one student matches.
export interface Typed { name?: string; student?: string; assignment?: string; page?: number; side?: Side }
export function readTyped(text: string, matches: Student[]): Typed {
  const ref = parseLooseCode(text)
  if (ref) return { student: ref.student, assignment: ref.assignment, page: ref.page, side: ref.side }
  const tokens = text.trim().split(/[\s:|·,/]+/).filter(Boolean)
  let i = 0
  while (i < tokens.length && !/\d/.test(tokens[i])) i++
  const name = tokens.slice(0, i).join(' ')
  if (!name) return {}
  const code = matches.length === 1 ? matches[0].code : null
  if (!code) return { name }
  const rest = tokens.slice(i)
  if (!rest.length) return { name, student: code }
  const r2 = parseLooseCode([code, ...rest].join(' '))
  return r2 ? { name, student: code, assignment: r2.assignment, page: r2.page, side: r2.side } : { name, student: code }
}

// Where a page came from: the PDF and page it was cut from, else the scanned file.
export function originLabel(p: { origin: string | null; originPage: number | null; sourceName: string }): string {
  if (p.origin) return `${p.origin.split('/').pop()}, page ${p.originPage ?? '?'}`
  return p.sourceName
}
