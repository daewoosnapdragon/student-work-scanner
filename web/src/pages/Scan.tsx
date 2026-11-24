import { useState } from 'react'
import { Link } from 'react-router-dom'
import { post, useFetch, fmtTime, type Assignment, type Pile } from '../api'
import { folderName, pileAction, pileLine } from './scanCopy'

interface PileRow extends Pile { assignmentTitle: string | null; filed: number; toCheck: number; looseFrom: number }
interface ScanData {
  status: { inbox: string; originals?: string; folder?: string; queued: number; busy: boolean; lastSeen: string | null }
  piles: PileRow[]
  loose: number
}

const hhmm = (iso: string) => fmtTime(iso).slice(0, 5)

// Stands in for the pile check and loose-page screens until they are built.
export function NotYet() {
  return (
    <main>
      <section className="col">
        <div className="over"><Link to="/scan">Scan</Link></div>
        <p className="lede">Coming in the next step.</p>
      </section>
    </main>
  )
}

export default function Scan() {
  const { data, error } = useFetch<ScanData>('/api/scan')
  const { data: assignments } = useFetch<Assignment[]>('/api/assignments')
  const piles = data?.piles ?? []
  // the one red button: the first pile that wants checking or settling, else sorting loose pages
  const primaryPile = piles.find((p) => ['check', 'settle'].includes(pileAction(p) ?? ''))?.id ?? null
  const folder = data ? (data.status.folder ?? folderName(data.status.inbox)) : ''
  return (
    <main>
      <section className="col" style={{ gap: 14 }}>
        <div className="over">Scanning</div>
        <div className="muted small" title={data?.status.inbox}>
          <span className="dot" style={{ background: data ? 'var(--green)' : 'var(--chip)' }} />
          {data ? `watching ${folder}` : 'Connecting to the scanner service'}
          {data?.status.lastSeen && ` · last page ${hhmm(data.status.lastSeen)}`}
          {data?.status.queued ? ` · ${data.status.queued} waiting` : ''}
        </div>
        <h1 className="serif title">Scan</h1>
        <p className="lede">Feed one assignment at a time: all the fronts, flip, all the backs.</p>
        {error && <p className="err">{error}</p>}
      </section>

      <section className="col" style={{ gap: 10 }}>
        <div className="over">Piles</div>
        {piles.map((p) => <PileCard key={p.id} p={p} assignments={assignments ?? []} primary={p.id === primaryPile} />)}
        {data && piles.length === 0 && <div className="notice">Nothing scanned yet. Feed a pile and it will appear here.</div>}
      </section>

      {data && (
        <section className="col" style={{ gap: 10 }}>
          <div className="card">
            <div className="between">
              <b className="serif">Loose pages</b>
              {data.loose > 0 && <Link to="/scan/loose" className={`btn${primaryPile == null ? ' primary' : ''}`}>Sort them</Link>}
            </div>
            <div className={data.loose ? '' : 'muted'}>{data.loose > 0 ? `${data.loose} page${data.loose === 1 ? '' : 's'} not from any pile` : 'No loose pages.'}</div>
          </div>
        </section>
      )}

      <section>
        <Link to="/scan/log">Everything that arrived, page by page →</Link>
      </section>
    </main>
  )
}

function PileCard({ p, assignments, primary }: { p: PileRow; assignments: Assignment[]; primary: boolean }) {
  const action = pileAction(p)
  const [code, setCode] = useState(p.assignment ?? '')
  const [making, setMaking] = useState(false)
  const [title, setTitle] = useState('')
  const [klass, setKlass] = useState('')
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true); setErr(null)
    try { await fn() } catch (e) { setErr((e as Error).message) } finally { setBusy(false) }
  }
  const settle = () => run(() => post(`/api/piles/${p.id}/assignment`, { code }))
  const create = () => run(() => post(`/api/piles/${p.id}/assignment`, { code, title, ...(klass.trim() ? { klass: klass.trim() } : {}) }))
  const undo = () => {
    if (!window.confirm('Undo this pile? Its pages go back as they arrived, replaced scans come back, and you can settle it again.')) return
    run(() => post(`/api/piles/${p.id}/undo`, {}))
  }
  return (
    <div className="card">
      <div className="between" style={{ gap: 12, flexWrap: 'wrap' }}>
        <div>
          <b className="serif">{p.name}</b>
          <span className="muted small"> · {hhmm(p.createdAt)}{p.assignment && ` · ${p.assignment}${p.assignmentTitle ? ` ${p.assignmentTitle}` : ''}`}</span>
        </div>
        <div className="row" style={{ gap: 8 }}>
          {action === 'check' && <Link to={`/scan/pile/${p.id}`} className={`btn${primary ? ' primary' : ''}`}>Check {p.toCheck}</Link>}
          {action === 'settle' && !making && (
            <>
              <label htmlFor={`as-${p.id}`} className="vh">Assignment for {p.name}</label>
              <select id={`as-${p.id}`} value={code} onChange={(e) => setCode(e.target.value)}>
                <option value="">Choose an assignment</option>
                {assignments.map((a) => <option key={a.code} value={a.code}>{a.code} · {a.title}</option>)}
              </select>
              <button className={`btn${primary ? ' primary' : ''}`} disabled={!code || busy} onClick={settle}>Settle it</button>
            </>
          )}
          {action === 'undo' && (
            <>
              {p.status === 'done' && p.assignment && <Link to={`/assignments/${p.assignment}`} className="btn">Open</Link>}
              <button className="btn" disabled={busy} onClick={undo}>Undo</button>
            </>
          )}
        </div>
      </div>
      <div className={p.status === 'jumbled' ? '' : 'muted'}>{pileLine(p)}</div>
      {action === 'settle' && (
        making ? (
          <form className="row" style={{ gap: 8, flexWrap: 'wrap' }} onSubmit={(e) => { e.preventDefault(); if (code.trim() && title.trim()) create() }}>
            <label className="vh" htmlFor={`nc-${p.id}`}>Assignment code</label>
            <input id={`nc-${p.id}`} type="text" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="Code, e.g. W23" style={{ width: 110 }} />
            <label className="vh" htmlFor={`nt-${p.id}`}>Assignment title</label>
            <input id={`nt-${p.id}`} type="text" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Title" />
            <label className="vh" htmlFor={`nk-${p.id}`}>Class, if no page names one</label>
            <input id={`nk-${p.id}`} type="text" value={klass} onChange={(e) => setKlass(e.target.value)} placeholder="Class (optional)" style={{ width: 130 }} />
            <button className="btn" disabled={!code.trim() || !title.trim() || busy}>Create and settle</button>
            <button type="button" className="btn" onClick={() => setMaking(false)}>Cancel</button>
          </form>
        ) : (
          <div className="small"><a href="#new" onClick={(e) => { e.preventDefault(); setMaking(true) }}>New assignment from these codes</a></div>
        )
      )}
      {err && <div className="err">{err}</div>}
    </div>
  )
}
