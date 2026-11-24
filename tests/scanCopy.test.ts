import { describe, expect, it } from 'vitest'
import { folderName, pileAction, pileLine } from '../web/src/pages/scanCopy'

const base = { pages: 48, sheets: 24 as number | null, twoSided: 1 as number | null, status: 'done' as const, filed: 24, toCheck: 0, looseFrom: 0, assignment: 'W23' as string | null }

describe('pileLine', () => {
  it('says all filed for a done pile', () => expect(pileLine(base)).toBe('24 sheets · all filed'))
  it('counts what was filed and what needs checking', () =>
    expect(pileLine({ ...base, status: 'checking', filed: 21, toCheck: 3 })).toBe('24 sheets · 21 filed on their own · 3 to check'))
  it('says no code read for a new pile', () =>
    expect(pileLine({ ...base, status: 'new', pages: 36, sheets: null, twoSided: null, assignment: null, filed: 0 })).toBe('36 pages · no code read'))
  it('explains a jumbled pile', () =>
    expect(pileLine({ ...base, status: 'jumbled', looseFrom: 4 })).toBe('The backs did not mirror the fronts, so nothing was filed by position; 4 pages went to loose pages.'))
})

describe('pileAction', () => {
  it('maps each status', () => {
    expect(pileAction({ ...base, status: 'checking' })).toBe('check')
    expect(pileAction({ ...base, status: 'new' })).toBe('settle')
    expect(pileAction({ ...base, status: 'done' })).toBe('undo')
    expect(pileAction({ ...base, status: 'jumbled' })).toBe('undo')
  })
})

describe('folderName', () => {
  it('takes the last segment of either slash kind', () => {
    expect(folderName('/home/t/scans/inbox')).toBe('inbox')
    expect(folderName('C:\\Users\\t\\Scans\\Inbox\\')).toBe('Inbox')
    expect(folderName('inbox')).toBe('inbox')
  })
})
