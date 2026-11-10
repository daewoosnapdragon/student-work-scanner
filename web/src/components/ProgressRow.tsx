import { parseProgress, progressDirection, SKILL_LEVEL_LABEL } from '../../../shared/types'

const ARROW: Record<string, { glyph: string; color: string; bg: string; word: string }> = {
  '1': { glyph: '↑', color: 'var(--green)', bg: '#dff0e5', word: 'moved up' },
  '0': { glyph: '→', color: 'var(--ink2)', bg: 'var(--paper)', word: 'held' },
  '-1': { glyph: '↓', color: 'var(--accent)', bg: '#f8dcd8', word: 'slipped' },
  null: { glyph: '·', color: 'var(--ink2)', bg: 'var(--paper)', word: 'first reading' },
}

/** What moved since the student's earlier work: one chip per skill, then the follow-up line. */
export default function ProgressRow({ raw, compact = false }: { raw: string | null | undefined; compact?: boolean }) {
  const p = parseProgress(raw)
  if (!p) return null
  return (
    <div className="col" style={{ gap: 6 }}>
      {p.items.length > 0 && (
        <div className="row" style={{ gap: 6, alignItems: 'baseline' }}>
          <span className="over quiet" style={{ fontSize: 10, marginRight: 4 }}>Since last time</span>
          {p.items.map((i) => {
            const d = progressDirection(i)
            const a = ARROW[String(d)]
            return (
              <span key={i.skill} className="chip" title={`${a.word}${i.note ? `: ${i.note}` : ''}`} style={{ background: a.bg, padding: compact ? '1px 6px' : undefined, fontSize: compact ? 11 : undefined }}>
                {i.skill} <b style={{ color: a.color }}>{i.from ? `${SKILL_LEVEL_LABEL[i.from]} ${a.glyph} ` : ''}{SKILL_LEVEL_LABEL[i.to]}</b>
              </span>
            )
          })}
        </div>
      )}
      {p.followedUp && <div className={compact ? 'small' : ''} style={{ margin: 0 }}><span className="over quiet" style={{ fontSize: 10, marginRight: 8 }}>Last time's try</span>{p.followedUp}</div>}
    </div>
  )
}
