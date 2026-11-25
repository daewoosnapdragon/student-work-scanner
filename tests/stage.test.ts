import { describe, expect, it } from 'vitest'
import { nextAction, stageLine } from '../web/src/pages/stage'

const row = { stage: 'scanning' as const, turnedIn: 16, roster: 18, toCheck: 3, missingSide: 0, analysed: 0, feedbackPrintedOn: null as string | null }

describe('stageLine', () => {
  it('scanning', () => expect(stageLine(row)).toBe('Scanning · 16 of 18 in · 3 to check'))
  it('scanning with nothing to check leaves that out', () => expect(stageLine({ ...row, toCheck: 0 })).toBe('Scanning · 16 of 18 in'))
  it('ready', () => expect(stageLine({ ...row, stage: 'ready', turnedIn: 18 })).toBe('Ready to analyse · 18 of 18 in'))
  it('ready with packets missing a side', () => expect(stageLine({ ...row, stage: 'ready', turnedIn: 18, missingSide: 2 })).toBe('Ready to analyse · 18 of 18 in · 2 missing a side'))
  it('analysing', () => expect(stageLine({ ...row, stage: 'analysing', analysed: 4 })).toBe('Analysing · 4 of 18 done'))
  it('analysed', () => expect(stageLine({ ...row, stage: 'analysed' })).toBe('Analysed · feedback not printed'))
  it('done', () => expect(stageLine({ ...row, stage: 'done', feedbackPrintedOn: '2026-11-09T14:03:00.000Z' })).toBe('Done · printed Nov 9'))
  it('done without a date', () => expect(stageLine({ ...row, stage: 'done' })).toBe('Done · printed'))
})

describe('nextAction', () => {
  const a = { code: 'W23', stage: 'scanning' as const, turnedIn: 16, analysisOn: true, pileId: 7 as number | null }
  it('scanning with a pile checks it', () => expect(nextAction(a)).toEqual({ label: 'Check pile', to: '/scan/pile/7', kind: 'link' }))
  it('scanning without a pile opens the assignment', () => expect(nextAction({ ...a, pileId: null })).toEqual({ label: 'Open', to: '/assignments/W23', kind: 'link' }))
  it('ready with a key analyses', () => expect(nextAction({ ...a, stage: 'ready' })).toEqual({ label: 'Analyse 16', to: '', kind: 'analyse' }))
  it('ready without a key copies the prompt', () => expect(nextAction({ ...a, stage: 'ready', analysisOn: false })).toEqual({ label: 'Copy prompt', to: '/assignments/W23?prompt=1', kind: 'link' }))
  it('analysing opens', () => expect(nextAction({ ...a, stage: 'analysing' })).toEqual({ label: 'Open', to: '/assignments/W23', kind: 'link' }))
  it('analysed prints feedback', () => expect(nextAction({ ...a, stage: 'analysed' })).toEqual({ label: 'Print feedback', to: '/print/feedback/W23', kind: 'print' }))
  it('done opens', () => expect(nextAction({ ...a, stage: 'done' })).toEqual({ label: 'Open', to: '/assignments/W23', kind: 'link' }))
})
