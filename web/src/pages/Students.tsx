import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useFetch, relDay, type Student } from '../api'

interface Row extends Student { samples: number; lastScanned: string | null; missing: number }

export default function Students() {
  const [params, setParams] = useSearchParams()
  const klass = params.get('class') ?? ''
  const q = params.get('q') ?? ''
  const [sort, setSort] = useState<'attention' | 'name' | 'last' | 'samples'>('attention')
  const [grade, setGrade] = useState('')
  const { data, error } = useFetch<{ students: Row[]; classes: string[] }>(`/api/students${klass ? `?class=${encodeURIComponent(klass)}` : ''}`)

  const rows = useMemo(() => {
    let r = data?.students ?? []
    if (q) {
      const t = q.toLowerCase()
      r = r.filter((s) => s.name.toLowerCase().includes(t) || (s.nameKo ?? '').includes(q) || s.code.toLowerCase().includes(t))
    }
    if (grade) r = r.filter((s) => String(s.grade ?? '') === grade)
    const by: Record<typeof sort, (a: Row, b: Row) => number> = {
      attention: (a, b) => b.missing - a.missing || a.samples - b.samples || a.name.localeCompare(b.name),
      name: (a, b) => a.name.localeCompare(b.name),
      last: (a, b) => (b.lastScanned ?? '').localeCompare(a.lastScanned ?? ''),
      samples: (a, b) => b.samples - a.samples,
    }
    return [...r].sort(by[sort])
  }, [data, q, grade, sort])

  const grades = [...new Set((data?.students ?? []).map((s) => s.grade).filter((g) => g != null))].sort() as number[]

  return (
    <main style={{ gap: 28 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over">The roster</div>
        <h1 className="serif title">Students</h1>
        <p className="lede">Everyone with work in the archive. Narrow by class, then by grade.</p>
        {error && <p className="err">{error}</p>}
      </section>

      <section className="col" style={{ gap: 14 }}>
        <div className="tabs">
          <button className={`tab ${klass ? '' : 'on'}`} onClick={() => setParams(q ? { q } : {})}>All classes</button>
          {data?.classes.map((c) => (
            <button key={c} className={`tab ${klass === c ? 'on' : ''}`} onClick={() => setParams({ class: c, ...(q ? { q } : {}) })}>{c}</button>
          ))}
        </div>
        <div className="row" style={{ gap: 12 }}>
          <label htmlFor="filter" className="vh">Filter students by name</label>
          <input id="filter" type="text" value={q} onChange={(e) => setParams({ ...(klass ? { class: klass } : {}), ...(e.target.value ? { q: e.target.value } : {}) })} placeholder="Filter students by name" style={{ width: 300 }} />
          <label htmlFor="grade" className="over quiet" style={{ fontSize: 10 }}>Grade</label>
          <select id="grade" value={grade} onChange={(e) => setGrade(e.target.value)}>
            <option value="">All</option>
            {grades.map((g) => <option key={g} value={String(g)}>{g}</option>)}
          </select>
          <label htmlFor="sort" className="over quiet" style={{ fontSize: 10, marginLeft: 12 }}>Sort</label>
          <select id="sort" value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}>
            <option value="attention">Needs attention</option>
            <option value="name">Name</option>
            <option value="last">Last scanned</option>
            <option value="samples">Samples</option>
          </select>
          <span className="muted small" style={{ marginLeft: 'auto' }}>{rows.length} students{klass ? ` · ${klass}` : ''}{grade ? ` · Grade ${grade}` : ''}</span>
        </div>
      </section>

      <section style={{ overflowX: 'auto' }}>
        <table>
          <thead>
            <tr><th style={{ width: 40 }}></th><th>Student</th><th style={{ width: 70 }}>Code</th><th style={{ width: 90 }}>Samples</th><th style={{ width: 130 }}>Last scanned</th><th>Still out</th><th style={{ width: 60 }}></th></tr>
          </thead>
          <tbody>
            {rows.map((s, i) => (
              <tr key={s.code}>
                <td className="serif" style={{ fontSize: 18, color: 'var(--accent)' }}>{i + 1}</td>
                <td><Link to={`/students/${s.code}`} className="name">{s.name}</Link><div className="kr">{[s.nameKo, s.homeroom].filter(Boolean).join(' · ')}</div></td>
                <td className="muted">{s.code}</td>
                <td>{s.samples}</td>
                <td className="muted">{relDay(s.lastScanned)}</td>
                <td>{s.missing === 0 ? <span className="muted">nothing</span> : `${s.missing} assignment${s.missing === 1 ? '' : 's'} not turned in`}</td>
                <td><Link to={`/students/${s.code}`} className="btn">Open</Link></td>
              </tr>
            ))}
            {data && rows.length === 0 && <tr><td colSpan={7} className="muted">No students match. Add students on the server with POST /api/students or the seed script.</td></tr>}
          </tbody>
        </table>
        <div className="between muted small" style={{ padding: '14px 10px' }}>
          <span>Sorted by {sort === 'attention' ? 'who has the most work still out, then the fewest samples' : sort}</span>
          <span><Link to="/compare">Compare two students</Link></span>
        </div>
      </section>
    </main>
  )
}
