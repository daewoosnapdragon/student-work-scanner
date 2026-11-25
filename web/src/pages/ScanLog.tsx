import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useFetch, fmtTime, sideLabel, type Page, type Packet } from '../api'

interface LogPage extends Page { studentName: string | null; packet: Packet | null }

export default function ScanLog() {
  const { data, error } = useFetch<LogPage[]>('/api/scan/log')
  const [all, setAll] = useState(false)
  const hidden = data?.filter((p) => p.status === 'replaced' || p.status === 'skipped').length ?? 0
  const rows = data?.filter((p) => all || (p.status !== 'replaced' && p.status !== 'skipped')) ?? []
  return (
    <main>
      <section className="col" style={{ gap: 14 }}>
        <div className="over"><Link to="/scan">Scan</Link> <span className="muted">/</span> Everything that arrived</div>
        <h1 className="serif title">Everything that arrived</h1>
        <p className="lede">Every page the scanner has taken in, newest first.</p>
        {error && <p className="err">{error}</p>}
      </section>
      <section className="col" style={{ gap: 8 }}>
        {(hidden > 0 || all) && (
          <label className="small muted"><input type="checkbox" checked={all} onChange={(e) => setAll(e.target.checked)} /> Show rescans and skipped</label>
        )}
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th style={{ width: 90 }}>Time</th><th style={{ width: 90 }}>Side</th><th>Student</th><th>Assignment</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map((p) => <Row key={p.id} p={p} />)}
              {data && rows.length === 0 && <tr><td colSpan={5} className="muted">Nothing scanned yet. Feed a pile and its pages will appear here.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function Row({ p }: { p: LogPage }) {
  const side = p.page != null ? sideLabel(p.page, p.side) : '?'
  let status: JSX.Element
  if (p.status === 'filed') {
    const pk = p.packet
    status = pk?.complete ? <>Filed · packet complete, {pk.sides} of {pk.expected} sides</> : <span className="muted">Waiting · {pk ? `${pk.expected - pk.sides} side${pk.expected - pk.sides === 1 ? '' : 's'} to go` : ''}</span>
  } else if (p.status === 'review') status = <Link to="/scan/loose">Loose page</Link>
  else if (p.status === 'replaced') status = <span className="muted">Replaced by a rescan</span>
  else status = <span className="muted">{p.status === 'not_work' ? 'Not student work' : 'Skipped'}</span>
  return (
    <tr>
      <td className="muted">{fmtTime(p.scannedAt)}</td>
      <td className={p.page == null ? 'muted' : ''}>{side}</td>
      <td>{p.student ? <Link to={`/students/${p.student}`} className="serif" style={{ fontSize: 15, color: 'var(--ink)' }}>{p.studentName ?? p.student}</Link> : <span className="muted">{p.reason ?? 'Code not readable'}</span>}</td>
      <td>{p.assignment ?? <span className="muted">?</span>}</td>
      <td>{status}</td>
    </tr>
  )
}
