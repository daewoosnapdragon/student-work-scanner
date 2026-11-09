import { Link } from 'react-router-dom'
import { useFetch, fmtTime, sideLabel, type Page, type Packet, type Assignment, type Student } from '../api'

interface FeedPage extends Page { studentName: string | null; packet: Packet | null }
interface TodayData {
  feed: FeedPage[]
  stats: { pagesToday: number; packetsFiledToday: number; inReview: number; incomplete: number; oldestIncompleteMin: number | null; pagesWeek: number; packetsWeek: number }
  outstanding: Array<{ assignment: Assignment; missing: Student[]; total: number }>
}
interface Status { inbox: string; queued: number; busy: boolean; lastSeen: string | null }

export default function Today() {
  const { data, error } = useFetch<TodayData>('/api/today')
  const { data: status } = useFetch<Status>('/api/status')
  const today = new Date().toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })
  const since = data?.feed.length ? fmtTime(data.feed[data.feed.length - 1].scannedAt).slice(0, 5) : null
  return (
    <main>
      <section className="col" style={{ gap: 14 }}>
        <div className="between">
          <div className="over">Scanning now · {today}</div>
          <div className="muted small">
            <span className="dot" style={{ background: status ? 'var(--green)' : 'var(--chip)' }} />
            {status ? `Watching ${status.inbox}` : 'Connecting to the scanner service'}
            {status?.lastSeen && ` · last page ${fmtTime(status.lastSeen)}`}
            {status?.queued ? ` · ${status.queued} waiting` : ''}
          </div>
        </div>
        <h1 className="serif title">Today</h1>
        {data && (
          <p className="lede">
            {data.stats.pagesToday === 0
              ? 'No pages yet today. Put a stack in the scanner and they will appear here as they arrive.'
              : `${data.stats.pagesToday} page${data.stats.pagesToday === 1 ? '' : 's'} in${since ? ` since ${since}` : ''}. ${words(data.stats.packetsFiledToday)} packet${data.stats.packetsFiledToday === 1 ? '' : 's'} filed on their own, ${data.stats.inReview === 0 ? 'nothing' : words(data.stats.inReview).toLowerCase()} waiting for you.`}
          </p>
        )}
        {error && <p className="err">{error}</p>}
      </section>

      <section>
        <div className="over" style={{ marginBottom: 8 }}>Arriving</div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th style={{ width: 90 }}>Time</th><th style={{ width: 90 }}>Side</th><th>Student</th><th>Assignment</th><th>Status</th></tr></thead>
            <tbody>
              {data?.feed.slice(0, 25).map((p) => <FeedRow key={p.id} p={p} />)}
              {data && data.feed.length === 0 && <tr><td colSpan={5} className="muted">Nothing scanned yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      {data && (
        <section className="stats">
          <div className="stat"><div className="over quiet">Pages today</div><div className="num">{data.stats.pagesToday}</div></div>
          <div className="stat"><div className="over quiet">Packets filed</div><div className="num">{data.stats.packetsFiledToday}</div></div>
          <div className="stat"><div className="over quiet">In review</div><div className="num"><Link to="/review">{data.stats.inReview}</Link></div></div>
          <div className="stat"><div className="over quiet">Incomplete</div><div className="num">{data.stats.incomplete}</div>{data.stats.oldestIncompleteMin != null && <div className="muted small">oldest {data.stats.oldestIncompleteMin} min</div>}</div>
          <div className="stat"><div className="over quiet">This week</div><div className="num">{data.stats.pagesWeek}</div><div className="muted small">pages, {data.stats.packetsWeek} packets</div></div>
        </section>
      )}

      <section className="grid2">
        <div className="col">
          <div className="over">Not yet turned in</div>
          <div className="col" style={{ gap: 14 }}>
            {data?.outstanding.map((o, i) => (
              <div key={o.assignment.code} style={i ? { borderTop: '1px solid var(--line2)', paddingTop: 14 } : undefined}>
                <div className="between">
                  <Link to={`/assignments/${o.assignment.code}`} className="serif" style={{ fontSize: 17, color: 'var(--ink)', fontWeight: 700 }}>{o.assignment.code} · {o.assignment.title}</Link>
                  <span className="muted small">{o.assignment.klass} · {o.missing.length === 0 ? 'all in' : `${o.missing.length} of ${o.total}`}</span>
                </div>
                {o.missing.length > 0 && <div style={{ marginTop: 4 }}>{o.missing.slice(0, 8).map((s) => s.name).join(' · ')}{o.missing.length > 8 && ` · and ${o.missing.length - 8} more`}</div>}
              </div>
            ))}
            {data && data.outstanding.length === 0 && <p className="muted" style={{ margin: 0 }}>No assignments yet. <Link to="/assignments">Set one up</Link> and print its labels.</p>}
          </div>
        </div>
        <div className="col">
          <div className="over">Worth noticing</div>
          <div className="notice">Analysis is not switched on yet. When it is, this corner will point out a student whose work has changed, with a link to the arc and a comparison.</div>
        </div>
      </section>
    </main>
  )
}

function FeedRow({ p }: { p: FeedPage }) {
  const side = p.page != null ? sideLabel(p.page, p.side) : '?'
  let status: JSX.Element
  if (p.status === 'filed') {
    const pk = p.packet
    status = pk?.complete ? <>Filed · packet complete, {pk.sides} of {pk.expected} sides</> : <span className="muted">Waiting · {pk ? `${pk.expected - pk.sides} side${pk.expected - pk.sides === 1 ? '' : 's'} to go` : ''}</span>
  } else if (p.status === 'review') status = <Link to="/review">In review</Link>
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

function words(n: number) {
  const w = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve']
  return w[n] ?? String(n)
}
