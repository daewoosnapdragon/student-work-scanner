export type Stage = 'scanning' | 'ready' | 'analysing' | 'analysed' | 'done'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** "Nov 9" from an ISO timestamp, read from its date part so the line does not depend on the viewer's locale. */
function shortDate(iso: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso)
  return m ? `${MONTHS[Number(m[2]) - 1]} ${Number(m[3])}` : ''
}

export function stageLine(row: { stage: Stage; turnedIn: number; roster: number; toCheck: number; missingSide: number; analysed: number; feedbackPrintedOn: string | null }): string {
  const inCount = `${row.turnedIn} of ${row.roster} in`
  switch (row.stage) {
    case 'scanning': return `Scanning · ${inCount}${row.toCheck > 0 ? ` · ${row.toCheck} to check` : ''}`
    case 'ready': return `Ready to analyse · ${inCount}${row.missingSide > 0 ? ` · ${row.missingSide} missing a side` : ''}`
    case 'analysing': return `Analysing · ${row.analysed} of ${row.roster} done`
    case 'analysed': return 'Analysed · feedback not printed'
    case 'done': {
      const d = row.feedbackPrintedOn ? shortDate(row.feedbackPrintedOn) : ''
      return d ? `Done · printed ${d}` : 'Done · printed'
    }
  }
}

export function nextAction(row: { code: string; stage: Stage; turnedIn: number; analysisOn: boolean; pileId: number | null }): { label: string; to: string; kind: 'link' | 'analyse' | 'print' } {
  const open = { label: 'Open', to: `/assignments/${row.code}`, kind: 'link' as const }
  switch (row.stage) {
    case 'scanning': return row.pileId != null ? { label: 'Check pile', to: `/scan/pile/${row.pileId}`, kind: 'link' } : open
    case 'ready': return row.analysisOn ? { label: `Analyse ${row.turnedIn}`, to: '', kind: 'analyse' } : { label: 'Copy prompt', to: `/assignments/${row.code}?prompt=1`, kind: 'link' }
    case 'analysed': return { label: 'Print feedback', to: `/print/feedback/${row.code}`, kind: 'print' }
    default: return open
  }
}
