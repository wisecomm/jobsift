import type { PostingKey, PostingPatch, StoredPosting } from '../shared/types'
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
  return (
    <li className={`card status-${p.status}`}>
      <div className="card-main">
        <h3>
          <a href={p.url} target="_blank" rel="noreferrer">
            {p.title}
          </a>
        </h3>
        <p className="company">
          {p.company}
          <span className="site">{siteName(p.site)}</span>
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
        {p.score !== null && (
          <p className="score">
            <strong>점수 {p.score}</strong>
            {p.scoreReason && <span> {p.scoreReason}</span>}
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
