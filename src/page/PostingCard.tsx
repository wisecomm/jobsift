import { careerLabel } from '../shared/career'
import { postingSources, type PostingKey, type PostingPatch, type StoredPosting } from '../shared/types'
import { deadlineLabel, formatDate, formatDateTime, locationSummary } from './format'
import { MemoField } from './MemoField'
import { siteName } from './sites'
import { STATUS_LABEL, actionsFor } from './statuses'

interface Props {
  posting: StoredPosting
  now: Date
  onUpdate: (key: PostingKey, patch: PostingPatch) => void
}

export function PostingCard({ posting: p, now, onUpdate }: Props) {
  const deadline = deadlineLabel(p.deadline, now)
  const key = { site: p.site, externalId: p.externalId }
  const sources = postingSources(p)
  const regionText = p.locations.length > 0 ? locationSummary(p.locations) : '지역무관'
  const matchText =
    p.matchedKeywords.length > 0
      ? `일치 키워드: ${p.matchedKeywords.join(', ')} · 지역: ${regionText}`
      : `지역: ${regionText}`

  return (
    <li className={`card status-${p.status}`}>
      <div className="card-main">
        <div className="card-meta">
          <span className="site-pill">
            {sources.length === 1
              ? siteName(p.site)
              : sources.map((source, index) => (
                  <span key={`${source.site}:${source.externalId}`}>
                    {index > 0 && ' · '}
                    <a href={source.url} target="_blank" rel="noreferrer">
                      {siteName(source.site)}
                    </a>
                  </span>
                ))}
          </span>
          <strong className="company-name">{p.company}</strong>
          <span className="meta-muted">· {regionText}</span>
          <span className="career-pill">{careerLabel(p.career)}</span>
          {p.score !== null && (
            <span className="score-pill" aria-label={`AI 점수 ${p.score}점`}>
              AI {p.score}점
            </span>
          )}
          {p.status !== 'new' && <span className="state-pill">{STATUS_LABEL[p.status]}</span>}
          <span className="meta-muted">· 등록: {formatDate(p.postedAt)}</span>
          <span className={deadline.date ? 'meta-deadline' : 'meta-muted'}>
            · 마감: {deadline.date ?? deadline.badge}
            {deadline.date && deadline.urgent ? ` (${deadline.badge})` : ''}
          </span>
          <span className="meta-muted">· 수집: {formatDateTime(p.collectedAt)}</span>
        </div>

        <h3 className="card-title">
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.title} <span aria-hidden="true">↗</span>
          </a>
        </h3>

        <div className="match-box">
          {p.score !== null && p.scoreReason ? (
            <>
              <strong>
                AI 평가 ({p.score}점
                {p.tokenUsage && p.tokenUsage.totalTokens > 0 ? ` · ~${p.tokenUsage.totalTokens.toLocaleString('ko-KR')}토큰` : ''}):
              </strong>{' '}
              {p.scoreReason}
            </>
          ) : (
            <>
              <strong>매칭 조건:</strong> {matchText}
            </>
          )}
        </div>

        <ul className="chips" aria-label="키워드 태그">
          {p.matchedKeywords.map((k) => (
            <li key={k}>#{k}</li>
          ))}
          {p.locations.length === 0 && <li>#지역무관</li>}
        </ul>
      </div>

      <div className="card-side">
        <div className="actions-row">
          {actionsFor(p.status).map((a) => (
            <button key={a.to} type="button" onClick={() => onUpdate(key, { status: a.to })}>
              {a.label}
            </button>
          ))}
        </div>
        <MemoField key={p.memo} memo={p.memo} onSave={(memo) => onUpdate(key, { memo })} />
      </div>
    </li>
  )
}
