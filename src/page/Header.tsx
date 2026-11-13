import type { CollectionSummary, ScoringSummary } from '../shared/types'
import { scoringLine, stopNotices, summaryLine } from './format'

interface Props {
  busy: boolean
  canCollect: boolean
  summary: CollectionSummary | null
  scoring: ScoringSummary | null
  pending: number
  onCollect: () => void
  onScorePending: () => void
}

export function Header({ busy, canCollect, summary, scoring, pending, onCollect, onScorePending }: Props) {
  return (
    <header className="app-header">
      <h1>채용공고 모음</h1>
      <div className="collect-box">
        <button type="button" className="primary" onClick={onCollect} disabled={busy || !canCollect}>
          {busy ? '수집 중…' : '지금 수집'}
        </button>
        {!canCollect && <span className="hint">조건 설정에서 키워드를 저장하면 수집할 수 있습니다.</span>}
      </div>
      {(summary || scoring || pending > 0) && (
        <div className="summary">
          {summary && <p data-testid="summary">{summaryLine(summary)}</p>}
          {scoring && <p data-testid="scoring">{scoringLine(scoring)}</p>}
          {scoring?.error && (
            <p role="alert" className="warn">
              AI 채점을 멈췄습니다. {scoring.error}
            </p>
          )}
          {pending > 0 && (
            <p className="pending-line" data-testid="pending">
              <span>채점 대기 {pending}건</span>
              <button type="button" onClick={onScorePending} disabled={busy}>
                대기 공고 채점
              </button>
            </p>
          )}
          {summary && stopNotices(summary).map((notice) => (
            <p key={notice} role="alert" className="warn">
              {notice}
            </p>
          ))}
        </div>
      )}
    </header>
  )
}
