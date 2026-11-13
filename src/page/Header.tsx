import type { CollectionSummary } from '../shared/types'
import { stopNotices, summaryLine } from './format'

interface Props {
  busy: boolean
  canCollect: boolean
  summary: CollectionSummary | null
  onCollect: () => void
}

export function Header({ busy, canCollect, summary, onCollect }: Props) {
  return (
    <header className="app-header">
      <h1>채용공고 모음</h1>
      <div className="collect-box">
        <button type="button" className="primary" onClick={onCollect} disabled={busy || !canCollect}>
          {busy ? '수집 중…' : '지금 수집'}
        </button>
        {!canCollect && <span className="hint">조건 설정에서 키워드를 저장하면 수집할 수 있습니다.</span>}
      </div>
      {summary && (
        <div className="summary">
          <p data-testid="summary">{summaryLine(summary)}</p>
          {stopNotices(summary).map((notice) => (
            <p key={notice} role="alert" className="warn">
              {notice}
            </p>
          ))}
        </div>
      )}
    </header>
  )
}
