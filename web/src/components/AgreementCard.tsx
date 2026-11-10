// How Claude's scores and ratings compare with the teacher's own: the one
// outside check on the analysis. Shown on an assignment and, across every
// assignment, in Settings.
export interface Pair { student: string; name: string; assignment: string; teacher: number; claude: number }
export interface Stat { key: string; n: number; exact: number; withinOne: number; meanDiff: number; disagreements: Pair[] }
export interface Agreement { score: Stat | null; domains: Stat[]; compared: number }

const pct = (x: number) => `${Math.round(x * 100)}%`
const lean = (d: number) => (Math.abs(d) < 0.05 ? 'no lean' : `Claude ${Math.abs(d).toFixed(1).replace(/\.0$/, '')} ${d > 0 ? 'high' : 'low'}`)
const leanColor = (d: number) => (Math.abs(d) < 0.4 ? 'var(--ink2)' : 'var(--accent)')

export default function AgreementCard({ ag, across, hint }: { ag: Agreement | null | undefined; across?: boolean; hint?: string }) {
  if (!ag || (!ag.score && !ag.domains.length)) {
    return <div className="notice">{hint ?? 'Nothing to compare yet. Rate a packet\'s domains by hand, or type a score, and once Claude has read the same packet the comparison shows here.'}</div>
  }
  const rows = [...(ag.score ? [ag.score] : []), ...ag.domains]
  const all = rows.flatMap((r) => r.disagreements)
  return (
    <div className="col" style={{ gap: 12 }}>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>What</th><th style={{ textAlign: 'center' }}>Compared</th><th style={{ textAlign: 'center' }}>Same</th><th style={{ textAlign: 'center' }}>Within one</th><th>Lean</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key}>
                <td style={{ fontWeight: 600 }}>{r.key === 'score' ? (across ? 'Score (out of 4 only)' : 'Score') : r.key.split(':')[0].trim()}</td>
                <td style={{ textAlign: 'center' }}>{r.n}</td>
                <td style={{ textAlign: 'center' }}>{pct(r.exact)}</td>
                <td style={{ textAlign: 'center' }}>{pct(r.withinOne)}</td>
                <td style={{ color: leanColor(r.meanDiff), fontWeight: Math.abs(r.meanDiff) >= 0.4 ? 600 : 400 }}>{lean(r.meanDiff)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {all.length > 0 && (
        <div className="col" style={{ gap: 4 }}>
          <div className="over quiet" style={{ fontSize: 10 }}>Where you differ · biggest gaps first</div>
          <div className="row" style={{ gap: 6 }}>
            {all.slice(0, 24).map((p, i) => {
              const r = rows.find((x) => x.disagreements.includes(p))!
              return <span key={`${r.key}-${p.assignment}-${p.student}-${i}`} className="chip" title={`${p.name}${across ? ` · ${p.assignment}` : ''} · ${r.key === 'score' ? 'score' : r.key}: you ${p.teacher}, Claude ${p.claude}`}>{p.name}{across ? ` · ${p.assignment}` : ''} · {r.key === 'score' ? 'score' : r.key.split(':')[0].trim()} <b>{p.teacher}</b><span className="muted"> vs {p.claude}</span></span>
            })}
            {all.length > 24 && <span className="muted small">and {all.length - 24} more</span>}
          </div>
        </div>
      )}
      <div className="muted small">Your rating is the standard; "lean" is Claude's average minus yours. A lean of 0.4 or more{across ? '' : ' on three or more packets'} goes into the prompt as a correction next time Claude reads this class's work.</div>
    </div>
  )
}
