import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useFetch, fmtDate, fileUrl, sideLabel, type Assignment, type Packet, type Page, type Student } from '../api'

interface PacketRow extends Packet { assignmentInfo: Assignment | null; pages: Page[] }
interface Data { student: Student; packets: PacketRow[]; missing: Assignment[]; pages: Page[] }

export default function StudentPage() {
  const { code } = useParams()
  const { data, error } = useFetch<Data>(`/api/students/${code}`)
  const [open, setOpen] = useState<string | null>(null)
  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>
  const { student: s, packets } = data
  const latest = data.pages[0]
  const complete = packets.filter((p) => p.complete && !p.closedIncomplete).length
  const scored = packets.filter((p) => p.score != null)
  return (
    <main>
      <section className="col" style={{ gap: 12 }}>
        <div className="over"><Link to="/students">Students</Link> <span className="muted">/</span> {s.code}</div>
        <h1 className="serif title">{s.name}</h1>
        <p className="serif" style={{ margin: 0, fontSize: 17, fontStyle: 'italic', color: 'var(--ink2)' }}>
          {[s.nameKo, s.grade != null && `Grade ${s.grade}`, s.klass, s.homeroom, `code ${s.code}`].filter(Boolean).join(' · ')}
        </p>
      </section>

      <section className="stats">
        <div className="stat"><div className="over quiet">Samples</div><div className="num">{data.pages.length}</div><div className="muted small">pages, {packets.length} packets</div></div>
        <div className="stat"><div className="over quiet">First scan</div><div className="num" style={{ fontSize: 22 }}>{data.pages.length ? fmtDate(data.pages[data.pages.length - 1].scannedAt) : '—'}</div></div>
        <div className="stat"><div className="over quiet">Complete packets</div><div className="num">{complete}</div></div>
        <div className="stat"><div className="over quiet">Scored</div><div className="num">{scored.length}</div>{scored.length > 0 && <div className="muted small">average {(scored.reduce((t, p) => t + (p.score! / (p.scoreOf || 1)), 0) / scored.length * 100).toFixed(0)}%</div>}</div>
        <div className="stat"><div className="over quiet">Missing</div><div className="num">{data.missing.length}</div>{data.missing.length > 0 && <div className="muted small">{data.missing.map((a) => a.code).join(', ')}</div>}</div>
      </section>

      <section className="grid2">
        <div className="col">
          <div className="over">Focus right now</div>
          <div className="notice">Analysis is not switched on yet. Skills, the week-by-week arc and the focus notes will live here once it is.</div>
          <div className="row"><Link to={`/compare?left=${s.code}`} className="btn">Compare with a classmate</Link></div>
        </div>
        <div className="col">
          <div className="over">Latest page</div>
          {latest ? (
            <>
              <div className="small">{latest.assignment} · {sideLabel(latest.page, latest.side)} · {fmtDate(latest.scannedAt)}</div>
              <a href={fileUrl(latest.filePath)} target="_blank" rel="noreferrer"><img className="scan" src={fileUrl(latest.thumbPath ?? latest.filePath)} alt={`${latest.assignment} ${sideLabel(latest.page, latest.side)}`} style={{ maxWidth: 360 }} /></a>
            </>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing scanned yet for {s.name}.</p>}
        </div>
      </section>

      <section className="col sep" style={{ gap: 14 }}>
        <div className="between">
          <div><span className="serif" style={{ fontSize: 26, fontWeight: 700 }}>Work record</span> <span className="muted small" style={{ marginLeft: 8 }}>{packets.length} packets, newest first</span></div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th style={{ width: 80 }}>Date</th><th>Assignment</th><th>Tags</th><th style={{ width: 110 }}>Sides</th><th style={{ width: 90 }}>Score</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {packets.map((p) => (
                <PacketRows key={p.assignment} p={p} open={open === p.assignment} toggle={() => setOpen(open === p.assignment ? null : p.assignment)} />
              ))}
              {packets.length === 0 && <tr><td colSpan={6} className="muted">No packets yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function PacketRows({ p, open, toggle }: { p: PacketRow; open: boolean; toggle: () => void }) {
  const a = p.assignmentInfo
  return (
    <>
      <tr>
        <td className="muted">{fmtDate(p.lastAt)}</td>
        <td><Link to={`/assignments/${p.assignment}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>{p.assignment}{a && ` · ${a.title}`}</Link>{a && <div className="muted small">{a.sheets} sheet{a.sheets === 1 ? '' : 's'}{a.twoSided ? ', both sides' : ''}</div>}</td>
        <td className="small">{a?.tags || <span className="muted">—</span>}</td>
        <td>{p.sides} of {p.expected}{p.closedIncomplete ? <div className="muted small">filed incomplete</div> : !p.complete ? <div className="muted small">still arriving</div> : null}</td>
        <td>{p.score != null ? `${p.score} of ${p.scoreOf ?? '?'}` : <span className="muted">—</span>}</td>
        <td><button className="btn" onClick={toggle}>{open ? 'Hide' : 'Pages'}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={6} style={{ background: 'var(--paper)' }}>
          <div className="thumbs">
            {p.pages.map((pg) => (
              <a key={pg.id} className="thumb" href={fileUrl(pg.filePath)} target="_blank" rel="noreferrer">
                <img src={fileUrl(pg.thumbPath ?? pg.filePath)} alt={sideLabel(pg.page, pg.side)} />
                <span>{sideLabel(pg.page, pg.side)}{pg.filedFrom === 'review' && <span className="muted"> · filed by hand</span>}</span>
              </a>
            ))}
          </div>
          {p.note && <p className="small" style={{ margin: '10px 0 0' }}>{p.note}</p>}
        </td></tr>
      )}
    </>
  )
}
