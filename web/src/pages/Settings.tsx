import { useEffect, useState } from 'react'
import { get, post } from '../api'

interface Settings { hasKey: boolean; keyHint: string | null; model: string; auto: boolean; context: string; domains: string[]; skills: string }

const TA = { width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' } as const

const MODELS = [
  { id: 'claude-opus-5-5', label: 'Claude Opus 5.5 · best reading of handwriting, about 5¢ a packet' },
  { id: 'claude-sonnet-5-5', label: 'Claude Sonnet 5.5 · quicker and about half the cost' },
  { id: 'claude-haiku-5-5', label: 'Claude Haiku 5.5 · cheapest, for trying things' },
]

export default function SettingsPage() {
  const [s, setS] = useState<Settings | null>(null)
  const [key, setKey] = useState('')
  const [model, setModel] = useState('claude-opus-5-5')
  const [auto, setAuto] = useState(false)
  const [context, setContext] = useState('')
  const [domains, setDomains] = useState('')
  const [skills, setSkills] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [testing, setTesting] = useState(false)
  useEffect(() => { get<Settings>('/api/settings').then((d) => { setS(d); setModel(d.model); setAuto(d.auto); setContext(d.context); setDomains(d.domains.join('\n')); setSkills(d.skills) }) }, [])

  async function save(extra: Partial<{ apiKey: string | null; skills: string }> = {}) {
    const d = await post<Settings>('/api/settings', { model, auto, context, domains: domains.split('\n').map((x) => x.trim()).filter(Boolean), skills, ...extra })
    setS(d)
    setSkills(d.skills)
    setKey('')
    setMsg('Saved.')
  }
  async function test() {
    setTesting(true)
    setMsg(null)
    try {
      const r = await post<{ ok: boolean; model: string; message: string }>('/api/settings/test', {})
      setMsg(r.ok ? `Working. ${r.model} answered "${r.message}".` : r.message)
    } finally {
      setTesting(false)
    }
  }

  return (
    <main style={{ gap: 28, maxWidth: 820 }}>
      <section className="col" style={{ gap: 10 }}>
        <div className="over">This computer</div>
        <h1 className="serif title">Settings</h1>
        <p className="lede">The analysis step reads each student's pages with Claude and writes the teacher's notes, the student's feedback, a score and the skills shown. It needs an API key, which is kept here on this computer only.</p>
      </section>

      <section className="card" style={{ gap: 14, padding: 20 }}>
        <div className="over quiet">Claude API key</div>
        <p className="small" style={{ margin: 0 }}>
          Get one at <a href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">console.anthropic.com</a> (Settings, then API keys, then Create key). Usage is billed to that account; a class set of 25 packets costs roughly a dollar with Opus.
          {s?.hasKey && <> A key is saved: <code>{s.keyHint}</code>.</>}
        </p>
        <form className="row" style={{ gap: 10 }} onSubmit={(e) => { e.preventDefault(); void save({ apiKey: key }) }}>
          <label htmlFor="key" className="vh">API key</label>
          <input id="key" type="password" value={key} onChange={(e) => setKey(e.target.value)} placeholder={s?.hasKey ? 'Paste a new key to replace the saved one' : 'sk-ant-…'} style={{ flex: 1, minWidth: 280 }} autoComplete="off" />
          <button type="submit" className="btn primary" disabled={!key.trim()}>Save key</button>
          {s?.hasKey && <button type="button" className="btn" onClick={() => void test()} disabled={testing}>{testing ? 'Testing' : 'Test'}</button>}
          {s?.hasKey && <button type="button" className="btn" onClick={() => { if (window.confirm('Remove the saved key? Analysis stops until a new one is saved.')) void save({ apiKey: null }) }}>Remove</button>}
        </form>
      </section>

      <section className="card" style={{ gap: 14, padding: 20 }}>
        <div className="over quiet">How it runs</div>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Model</span>
          <select value={model} onChange={(e) => setModel(e.target.value)}>{MODELS.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</select>
        </label>
        <label className="row"><input type="checkbox" checked={auto} onChange={(e) => setAuto(e.target.checked)} /> Analyse each packet on its own as soon as its last side is scanned</label>
        <p className="muted small" style={{ margin: 0 }}>Off, you press Analyse on an assignment's page when you are ready. Either way the class summary is written after the students.</p>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>About your class, for Claude</span>
          <textarea value={context} onChange={(e) => setContext(e.target.value)} rows={5} placeholder={'Anything that should shape every analysis. For example: "Grades 1 to 5 at an elementary school in Korea; English is a second language for all of them. Feedback to students should be short, warm, and quote their own words. Mention Korean names only in Korean."'} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
        </label>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>Domains rated 1 to 4, one per line</span>
          <textarea value={domains} onChange={(e) => setDomains(e.target.value)} rows={6} style={{ width: '100%', font: 'inherit', fontSize: 13.5, padding: '8px 10px', border: '1px solid var(--chip)', borderRadius: 3, background: '#fff', resize: 'vertical' }} />
          <span className="muted small">Every analysis rates each of these, and the assignment's overview table and printed record use them as columns. Keep the names short; a colon separates a name from its detail, as in "Language: grammar and vocabulary".</span>
        </label>
        <div className="row"><button className="btn primary" onClick={() => void save()}>Save</button>{msg && <span className="small">{msg}</span>}</div>
      </section>

      <section className="card" style={{ gap: 14, padding: 20 }}>
        <div className="over quiet">Skill names</div>
        <p className="small" style={{ margin: 0 }}>
          The analysis names the skills each piece of work shows, and the student page follows them from one assignment to the next. That only works when a skill is always called the same thing, so every name comes from this list: Claude picks from it, a pasted answer is folded onto it, and Worksheet Studio reads it (at <code>/api/skills</code>) to tag worksheets with the same names.
        </p>
        <label className="col" style={{ gap: 4 }}><span className="over quiet" style={{ fontSize: 10 }}>One skill a line · <code># Group</code> starts a group · after <code>|</code>, other names for the same skill, comma separated</span>
          <textarea value={skills} onChange={(e) => setSkills(e.target.value)} rows={18} spellCheck={false} style={{ ...TA, fontFamily: 'ui-monospace, Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.5 }} />
          <span className="muted small">Renaming a skill here renames it everywhere it has been recorded. The other names matter: "verb agreement" or "she go" in a pasted answer both become "subject-verb agreement".</span>
        </label>
        <div className="row">
          <button className="btn primary" onClick={() => void save()}>Save</button>
          <button className="btn" onClick={() => { if (window.confirm('Put the default list back? Your edits to the skill names are lost; recorded skills are refiled under the default names.')) void save({ skills: '' }) }}>Reset to default</button>
          {msg && <span className="small">{msg}</span>}
        </div>
      </section>

      <section className="col" style={{ gap: 8 }}>
        <div className="over quiet">What gets sent</div>
        <p className="small" style={{ margin: 0 }}>For each packet: its page images, the student's name and code, the assignment's title and tags, and the text above. For the class summary: the teacher notes already written. Nothing is sent until you add a key, and nothing is sent for packets you do not analyse.</p>
      </section>
    </main>
  )
}
