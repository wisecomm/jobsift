import { postingSources, type PostingKey, type PostingPatch, type StoredPosting } from '../shared/types'
import { careerLabel } from '../shared/career'
import { deadlineLabel, formatDate, locationSummary } from './format'
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
  return (
    <li className={`card status-${p.status}`}>
      {p.score !== null && (
        <div className="score-badge" aria-label={`AI 점수 ${p.score}점`}>
          <strong>{p.score}</strong>
          <span>점</span>
        </div>
      )}
      <div className="card-main">
        <h3>
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.title}
          </a>
        </h3>
        <p className="company">
          {p.company}
          <span className="site">
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
          {p.status !== 'new' && <span className="state">{STATUS_LABEL[p.status]}</span>}
        </p>
        <dl className="facts">
          <div><dt>지역</dt><dd>{locationSummary(p.locations)}</dd></div>
          <div><dt>경력</dt><dd>{careerLabel(p.career)}</dd></div>
          <div><dt>등록</dt><dd>{formatDate(p.postedAt)}</dd></div>
          <div>
            <dt>마감</dt>
            <dd>
              {deadline.date && `${deadline.date} `}
              <span className={deadline.urgent ? 'badge urgent' : 'badge'}>{deadline.badge}</span>
            </dd>
          </div>
        </dl>
        {p.matchedKeywords.length > 0 && (
          <ul className="chips" aria-label="일치한 키워드">
            {p.matchedKeywords.map((k) => (
              <li key={k}>{k}</li>
            ))}
          </ul>
        )}
        {p.score !== null && p.scoreReason && (
          <p className="reason" title={p.scoreReason}>
            {p.scoreReason}
          </p>
        )}
        <MemoField key={p.memo} memo={p.memo} onSave={(memo) => onUpdate(key, { memo })} />
      </div>
      <div className="actions">
        {actionsFor(p.status).map((a) => (
          <button key={a.to} type="button" onClick={() => onUpdate(key, { status: a.to })}>
            {a.label}
          </button>
        ))}
      </div>
    </li>
  )
}
