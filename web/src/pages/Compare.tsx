import { useSearchParams } from 'react-router-dom'
import { Link } from 'react-router-dom'
import { useFetch, fileUrl, sideLabel, type Assignment, type Packet, type Page, type Student } from '../api'

interface SideData { student: Student; packet: Packet | null; pages: Page[] }
interface Data { assignment: Assignment; sides: Array<{ page: number; side: 'a' | 'b' }>; left: SideData | null; right: SideData | null }

export default function Compare() {
  const [params, setParams] = useSearchParams()
  const assignment = params.get('assignment') ?? ''
  const left = params.get('left') ?? ''
  const right = params.get('right') ?? ''
  const side = params.get('side') ?? ''
  const { data: assignments } = useFetch<Assignment[]>('/api/assignments')
  const { data: roster } = useFetch<{ students: Student[] }>('/api/students')
  const { data, error } = useFetch<Data>(assignment ? `/api/compare?assignment=${assignment}&left=${left}&right=${right}` : null)
  const set = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v)
    else next.delete(k)
    setParams(next)
  }
  const a = data?.assignment
  const klassStudents = roster?.students.filter((s) => !a || s.klass === a.klass) ?? []
  const shown = data ? data.sides.filter((s) => !side || `${s.page}${s.side}` === side) : []

  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over">Side by side</div>
        <h1 className="serif title">Compare</h1>
        <p className="lede">Two students on the same work. Pick the assignment, then the two names.</p>
        {error && <p className="err">{error}</p>}
      </section>

      <section className="row" style={{ gap: 16, alignItems: 'flex-end' }}>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Assignment</span>
          <select value={assignment} onChange={(e) => set('assignment', e.target.value)}><option value="">Choose</option>{assignments?.map((x) => <option key={x.code} value={x.code}>{x.code} · {x.title}</option>)}</select>
        </label>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Left</span>
          <select value={left} onChange={(e) => set('left', e.target.value)}><option value="">Choose</option>{klassStudents.map((s) => <option key={s.code} value={s.code}>{s.name} · {s.code}</option>)}</select>
        </label>
        <span className="serif muted" style={{ fontSize: 18, paddingBottom: 6 }}>vs</span>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Right</span>
          <select value={right} onChange={(e) => set('right', e.target.value)}><option value="">Choose</option>{klassStudents.map((s) => <option key={s.code} value={s.code}>{s.name} · {s.code}</option>)}</select>
        </label>
        {data && (
          <div className="row" style={{ marginLeft: 'auto' }}>
            <span className="over quiet" style={{ fontSize: 10 }}>Show</span>
            <button className={`chip ${!side ? 'on' : ''}`} onClick={() => set('side', '')}>All</button>
            {data.sides.map((s) => <button key={`${s.page}${s.side}`} className={`chip ${side === `${s.page}${s.side}` ? 'on' : ''}`} onClick={() => set('side', `${s.page}${s.side}`)}>{sideLabel(s.page, s.side)}</button>)}
          </div>
        )}
      </section>

      {data && (
        <section className="grid2" style={{ gap: 24 }}>
          <Column d={data.left} sides={shown} />
          <Column d={data.right} sides={shown} />
        </section>
      )}

      {data && (
        <section className="col sep" style={{ gap: 10 }}>
          <div className="over">What differs</div>
          <div className="notice">Analysis is not switched on yet. The written comparison will go here. For now the pages scroll together above.</div>
        </section>
      )}
    </main>
  )
}

function Column({ d, sides }: { d: SideData | null; sides: Array<{ page: number; side: 'a' | 'b' }> }) {
  if (!d) return <div className="notice">Pick a student.</div>
  return (
    <div className="col">
      <div className="between">
        <Link to={`/students/${d.student.code}`} className="serif" style={{ fontSize: 22, fontWeight: 700, color: 'var(--ink)' }}>{d.student.name}</Link>
        <span className="muted small">{d.packet ? (d.packet.score != null ? `${d.packet.score} of ${d.packet.scoreOf ?? '?'}` : `${d.packet.sides} of ${d.packet.expected} sides`) : 'not turned in'}</span>
      </div>
      {sides.map((s) => {
        const pg = d.pages.find((p) => p.page === s.page && p.side === s.side)
        return (
          <div key={`${s.page}${s.side}`} className="col" style={{ gap: 4 }}>
            <div className="over quiet" style={{ fontSize: 10 }}>{sideLabel(s.page, s.side)}</div>
            {pg ? <a href={fileUrl(pg.filePath)} target="_blank" rel="noreferrer"><img className="scan" src={fileUrl(pg.filePath)} alt={`${d.student.name} ${sideLabel(s.page, s.side)}`} loading="lazy" /></a> : <div className="notice">Not scanned.</div>}
          </div>
        )
      })}
    </div>
  )
}
