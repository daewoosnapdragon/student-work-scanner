import { describe, expect, it } from 'vitest'
import { canUndo, folderName, pileAction, pileLine } from '../web/src/pages/scanCopy'

const base = { pages: 48, sheets: 24 as number | null, twoSided: 1 as number | null, status: 'done' as const, filed: 24, toCheck: 0, looseFrom: 0, assignment: 'W23' as string | null, codeAssignment: null as string | null, codeSetUp: false, arriving: false, pagesIn: 48 }

describe('pileLine', () => {
  it('says all filed for a done pile', () => expect(pileLine(base)).toBe('24 sheets · all filed'))
  it('counts what was filed and what needs checking', () =>
    expect(pileLine({ ...base, status: 'checking', filed: 21, toCheck: 3 })).toBe('24 sheets · 21 filed on their own · 3 to check'))
  it('says no code read for a new pile', () =>
    expect(pileLine({ ...base, status: 'new', pages: 36, sheets: null, twoSided: null, assignment: null, filed: 0 })).toBe('36 pages · no code read'))
  it('names the assignment the codes read for a waiting pile, and says when it is not set up', () => {
    const waiting = { ...base, status: 'new' as const, pages: 2, sheets: null, assignment: null, filed: 0 }
    expect(pileLine({ ...waiting, codeAssignment: 'W30', codeSetUp: false })).toBe('2 pages · codes read for W30, which is not set up')
    expect(pileLine({ ...waiting, codeAssignment: 'W14', codeSetUp: true })).toBe('2 pages · codes read for W14')
  })
  it('says a pile is still arriving', () =>
    expect(pileLine({ ...base, status: 'new', pages: 8, pagesIn: 3, arriving: true, assignment: null })).toBe('Still arriving, 3 of 8 pages in'))
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
  it('offers nothing while a pile is arriving', () => expect(pileAction({ ...base, status: 'new', arriving: true })).toBeNull())
  it('lets every settled pile be undone, a checking one too', () => {
    expect(canUndo({ ...base, status: 'checking' })).toBe(true)
    expect(canUndo({ ...base, status: 'done' })).toBe(true)
    expect(canUndo({ ...base, status: 'jumbled' })).toBe(true)
    expect(canUndo({ ...base, status: 'new' })).toBe(false)
  })
})

describe('folderName', () => {
  it('takes the last segment of either slash kind', () => {
    expect(folderName('/home/t/scans/inbox')).toBe('inbox')
    expect(folderName('C:\\Users\\t\\Scans\\Inbox\\')).toBe('Inbox')
    expect(folderName('inbox')).toBe('inbox')
  })
})
