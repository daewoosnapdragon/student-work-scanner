import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useFetch, fmtDate, fileUrl, sideLabel, type Assignment, type Packet, type Page, type Student } from '../api'
import ProgressRow from '../components/ProgressRow'
import { ScanLink, type ViewerPage } from '../components/Viewer'

interface PacketRow extends Packet { assignmentInfo: Assignment | null; pages: Page[] }
interface Skill { student: string; assignment: string; name: string; level: 'secure' | 'developing' | 'not_yet'; evidence: string | null; at: string }
interface Rating { student: string; assignment: string; domain: string; level: number; note: string | null; at: string }
interface Data { student: Student; packets: PacketRow[]; missing: Assignment[]; pages: Page[]; skills: Skill[]; ratings: Rating[]; domains: string[]; skillGroups: Record<string, string> }
const LEVEL_BG: Record<number, string> = { 4: '#dff0e5', 3: '#eef5e9', 2: '#fff3d6', 1: '#f8dcd8' }

export default function StudentPage() {
  const { code } = useParams()
  const { data, error } = useFetch<Data>(`/api/students/${code}`)
  const [open, setOpen] = useState<string | null>(null)
  if (error) return <main><p className="err">{error}</p></main>
  if (!data) return <main><p className="muted">Loading</p></main>
  const { student: s, packets } = data
  const latest = data.pages[0]
  // Every page of this student, newest first, so the arrows walk back through their work.
  const allPages: ViewerPage[] = data.pages.map((pg) => ({ src: fileUrl(pg.filePath), label: `${pg.assignment} · ${sideLabel(pg.page, pg.side)}`, sub: `${s.name} · ${fmtDate(pg.scannedAt)}` }))
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
          <Focus skills={data.skills} />
          <div className="row"><Link to={`/compare?left=${s.code}`} className="btn">Compare with a classmate</Link></div>
        </div>
        <div className="col">
          <div className="over">Latest page</div>
          {latest ? (
            <>
              <div className="small">{latest.assignment} · {sideLabel(latest.page, latest.side)} · {fmtDate(latest.scannedAt)}</div>
              <ScanLink pages={allPages} index={0} style={{ maxWidth: 360 }}><img className="scan" src={fileUrl(latest.thumbPath ?? latest.filePath)} alt={`${latest.assignment} ${sideLabel(latest.page, latest.side)}`} /></ScanLink>
            </>
          ) : <p className="muted" style={{ margin: 0 }}>Nothing scanned yet for {s.name}.</p>}
        </div>
      </section>

      {data.skills.length > 0 && <Arc skills={data.skills} packets={packets} groups={data.skillGroups ?? {}} />}

      <section className="col sep" style={{ gap: 14 }}>
        <div className="between">
          <div><span className="serif" style={{ fontSize: 26, fontWeight: 700 }}>Work record</span> <span className="muted small" style={{ marginLeft: 8 }}>{packets.length} packets, newest first</span></div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table>
            <thead><tr><th style={{ width: 80 }}>Date</th><th>Assignment</th><th>Tags</th><th style={{ width: 110 }}>Sides</th><th style={{ width: 90 }}>Score</th><th style={{ width: 90 }}></th></tr></thead>
            <tbody>
              {packets.map((p) => (
                <PacketRows key={p.assignment} p={p} ratings={data.ratings.filter((r) => r.assignment === p.assignment)} open={open === p.assignment} toggle={() => setOpen(open === p.assignment ? null : p.assignment)} />
              ))}
              {packets.length === 0 && <tr><td colSpan={6} className="muted">No packets yet.</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  )
}

function PacketRows({ p, ratings, open, toggle }: { p: PacketRow; ratings: Rating[]; open: boolean; toggle: () => void }) {
  const a = p.assignmentInfo
  const panel = (p.note || p.feedback) ? (
    <>
      <div className="over" style={{ fontSize: 10 }}>{p.assignment}{a && ` · ${a.title}`}</div>
      {p.note && <div><div className="over quiet" style={{ fontSize: 10, marginBottom: 4 }}>Analysis · for you</div><p>{p.note}</p></div>}
      {p.feedback && <div><div className="over quiet" style={{ fontSize: 10, marginBottom: 4 }}>Feedback · for the student</div><p>{p.feedback}</p></div>}
    </>
  ) : undefined
  const viewPages: ViewerPage[] = p.pages.map((pg) => ({ src: fileUrl(pg.filePath), label: `${p.assignment} · ${sideLabel(pg.page, pg.side)}`, sub: a?.title, panel }))
  return (
    <>
      <tr>
        <td className="muted">{fmtDate(p.lastAt)}</td>
        <td><Link to={`/assignments/${p.assignment}`} style={{ color: 'var(--ink)', fontWeight: 600 }}>{p.assignment}{a && ` · ${a.title}`}</Link>{a && <div className="muted small">{a.sheets} sheet{a.sheets === 1 ? '' : 's'}{a.twoSided ? ', both sides' : ''}</div>}</td>
        <td className="small">{a?.tags || <span className="muted">—</span>}{ratings.length > 0 && <div className="row" style={{ gap: 4, marginTop: 4 }}>{ratings.map((r) => <span key={r.domain} className="chip" title={`${r.domain}${r.note ? `: ${r.note}` : ''}`} style={{ background: LEVEL_BG[r.level], padding: '1px 6px', fontSize: 11 }}>{r.domain.split(':')[0].trim()} <b>{r.level}</b></span>)}</div>}</td>
        <td>{p.sides} of {p.expected}{p.closedIncomplete ? <div className="muted small">filed incomplete</div> : !p.complete ? <div className="muted small">still arriving</div> : null}</td>
        <td>{p.score != null ? `${p.score} of ${p.scoreOf ?? '?'}` : <span className="muted">—</span>}</td>
        <td><button className="btn" onClick={toggle}>{open ? 'Hide' : p.note ? 'Pages · analysis' : 'Pages'}</button></td>
      </tr>
      {open && (
        <tr><td colSpan={6} style={{ background: 'var(--paper)' }}>
          <div className="thumbs">
            {p.pages.map((pg, i) => (
              <div key={pg.id} className="thumb">
                <ScanLink pages={viewPages} index={i}><img src={fileUrl(pg.thumbPath ?? pg.filePath)} alt={sideLabel(pg.page, pg.side)} /></ScanLink>
                <span>{sideLabel(pg.page, pg.side)}{pg.filedFrom === 'review' && <span className="muted"> · filed by hand</span>}</span>
              </div>
            ))}
          </div>
          {p.progress && <div style={{ marginTop: 12 }}><ProgressRow raw={p.progress} compact /></div>}
          {(p.note || p.feedback) && (
            <div className="grid2" style={{ marginTop: 12, gap: 24 }}>
              {p.note && <div><div className="over quiet" style={{ fontSize: 10, marginBottom: 4 }}>Analysis · for you</div><p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.note}</p></div>}
              {p.feedback && <div><div className="over quiet" style={{ fontSize: 10, marginBottom: 4 }}>Feedback · for the student <a href={`/print/feedback/${p.assignment}/${p.student}`} target="_blank" rel="noreferrer" style={{ marginLeft: 8, letterSpacing: 0, textTransform: 'none' }}>print slip</a></div><p className="small" style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{p.feedback}</p></div>}
            </div>
          )}
        </td></tr>
      )}
    </>
  )
}


const LEVEL_LABEL = { secure: 'secure', developing: 'developing', not_yet: 'not yet' } as const
const LEVEL_COLOR = { secure: 'var(--green)', developing: '#c9a24a', not_yet: 'var(--accent)' } as const

// The newest reading of each skill, the ones still developing first.
function latestSkills(skills: Skill[]) {
  const by = new Map<string, Skill>()
  for (const k of [...skills].sort((a, b) => a.at.localeCompare(b.at))) by.set(k.name, k)
  const order = { not_yet: 0, developing: 1, secure: 2 }
  return [...by.values()].sort((a, b) => order[a.level] - order[b.level] || b.at.localeCompare(a.at))
}

function Focus({ skills }: { skills: Skill[] }) {
  if (!skills.length) return <div className="notice">No analysis yet. Analyse a packet on its assignment page, or paste Claude's answer there, and the skills this student shows will gather here.</div>
  const latest = latestSkills(skills)
  const focus = latest.filter((k) => k.level !== 'secure').slice(0, 4)
  const secure = latest.filter((k) => k.level === 'secure')
  return (
    <div className="col" style={{ gap: 10 }}>
      {focus.length === 0 && <p style={{ margin: 0 }}>Everything the recent work shows is secure.</p>}
      {focus.map((k) => (
        <div key={k.name} style={{ borderLeft: `3px solid ${LEVEL_COLOR[k.level]}`, paddingLeft: 10 }}>
          <div style={{ fontWeight: 600 }}>{k.name} <span className="muted small" style={{ fontWeight: 400 }}>· {LEVEL_LABEL[k.level]} · {k.assignment}</span></div>
          {k.evidence && <div className="small muted">“{k.evidence}”</div>}
        </div>
      ))}
      {secure.length > 0 && <div className="small"><span className="over quiet" style={{ fontSize: 10, marginRight: 8 }}>Secure</span>{secure.map((k) => k.name).join(' · ')}</div>}
    </div>
  )
}

// Skills across assignments, oldest to newest: a dot per reading. Rows sit
// under their vocabulary group, the ones still developing first within each.
function Arc({ skills, packets, groups }: { skills: Skill[]; packets: PacketRow[]; groups: Record<string, string> }) {
  const cols = [...new Set(skills.map((k) => k.assignment))].sort((a, b) => (skills.find((k) => k.assignment === a)!.at).localeCompare(skills.find((k) => k.assignment === b)!.at))
  const byLevel = latestSkills(skills).map((k) => k.name)
  const groupOrder = [...new Set(Object.values(groups))]
  const groupOf = (n: string) => groups[n] ?? 'Other'
  const names = [...byLevel].sort((a, b) => {
    const ga = groupOrder.indexOf(groupOf(a)), gb = groupOrder.indexOf(groupOf(b))
    return (ga === -1 ? 1e9 : ga) - (gb === -1 ? 1e9 : gb) || byLevel.indexOf(a) - byLevel.indexOf(b)
  })
  const showGroups = new Set(names.map(groupOf)).size > 1
  const titleOf = (code: string) => packets.find((p) => p.assignment === code)?.assignmentInfo?.title ?? code
  return (
    <section className="col sep" style={{ gap: 12 }}>
      <div className="between">
        <div><span className="serif" style={{ fontSize: 26, fontWeight: 700 }}>Skill arc</span> <span className="muted small" style={{ marginLeft: 8 }}>{cols.length} assignment{cols.length === 1 ? '' : 's'} analysed</span></div>
        <div className="small row" style={{ gap: 14 }}>{(['secure', 'developing', 'not_yet'] as const).map((l) => <span key={l}><span className="dot" style={{ background: LEVEL_COLOR[l] }} />{LEVEL_LABEL[l]}</span>)}</div>
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table>
          <thead><tr><th>Skill</th>{cols.map((c) => <tr key={c} style={{ display: 'contents' }}><th style={{ textAlign: 'center' }} title={titleOf(c)}>{c}<div className="muted" style={{ fontWeight: 400, textTransform: 'none', letterSpacing: 0 }}>{fmtDate(skills.find((k) => k.assignment === c)!.at)}</div></th></tr>)}</tr></thead>
          <tbody>
            {names.map((n, i) => (
              <tr key={n}>
                <td style={{ fontWeight: 600 }}>{showGroups && (i === 0 || groupOf(names[i - 1]) !== groupOf(n)) && <div className="over quiet" style={{ fontSize: 10, marginBottom: 2 }}>{groupOf(n)}</div>}{n}</td>
                {cols.map((c) => { const k = skills.find((x) => x.name === n && x.assignment === c); return <td key={c} style={{ textAlign: 'center' }} title={k ? `${LEVEL_LABEL[k.level]}${k.evidence ? `: ${k.evidence}` : ''}` : 'no sample'}>{k ? <span className="dot" style={{ background: LEVEL_COLOR[k.level], width: 12, height: 12, marginRight: 0 }} /> : <span className="muted">·</span>}</td> })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}
