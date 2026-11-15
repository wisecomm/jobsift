import type { CollectionReport, ScoringSummary } from '../shared/types'
import { DEFAULT_BATCH_HOURS, MAX_BATCH_HOURS, formatClockTime } from './batchSchedule'
import { reportLines, reportNotices, scoringLine } from './format'
import { siteName } from './sites'

interface Props {
  busy: boolean
  canCollect: boolean
  progress?: string | null
  report: CollectionReport | null
  scoring: ScoringSummary | null
  pending: number
  resumableBySite?: Record<string, string[]>
  batchEnabled?: boolean
  batchHours?: number
  nextBatchAt?: number | null
  onToggleBatch?: (enabled: boolean) => void
  onChangeBatchHours?: (hours: number) => void
  onCollect: () => void
  onContinueCollect?: (site: string, keyword?: string) => void
  onResetCollect: () => void
  onScorePending: () => void
  onCancel?: () => void
}

export function Header({
  busy,
  canCollect,
  progress,
  report,
  scoring,
  pending,
  resumableBySite,
  batchEnabled = false,
  batchHours = DEFAULT_BATCH_HOURS,
  nextBatchAt = null,
  onToggleBatch,
  onChangeBatchHours,
  onCollect,
  onContinueCollect,
  onResetCollect,
  onScorePending,
  onCancel,
}: Props) {
  const lines = report && reportLines(report, siteName)
  const notices = reportNotices(report, siteName, resumableBySite)
  const showSummary = Boolean(report || scoring || pending > 0 || notices.length > 0)
  return (
    <header className="app-header">
      <h1>JobSift</h1>
      <div className="collect-box">
        <div className="collect-actions">
          <button type="button" className="primary" onClick={onCollect} disabled={busy || !canCollect}>
            {busy ? '수집 중…' : '지금 수집'}
          </button>
          <button
            type="button"
            onClick={() => window.confirm('저장된 공고를 모두 지우고 처음부터 다시 수집합니다. 계속할까요?') && onResetCollect()}
            disabled={busy || !canCollect}
          >
            초기화(수집)
          </button>
          {busy && onCancel && (
            <button type="button" onClick={onCancel}>
              중단
            </button>
          )}
        </div>
        {onToggleBatch && (
          <div className="batch-bar">
            <label className="batch-toggle">
              <input
                type="checkbox"
                checked={batchEnabled}
                disabled={!canCollect}
                onChange={(e) => onToggleBatch(e.target.checked)}
              />
              <span>자동 배치</span>
            </label>
            {onChangeBatchHours && (
              <label className="batch-hours">
                <input
                  type="number"
                  min={1}
                  max={MAX_BATCH_HOURS}
                  step={1}
                  value={batchHours}
                  disabled={!canCollect}
                  aria-label="배치 실행 간격(시간)"
                  onChange={(e) => onChangeBatchHours(Number(e.target.value))}
                />
                <span>시간마다</span>
              </label>
            )}
            {batchEnabled && (
              <span className="hint" data-testid="batch-next">
                {busy
                  ? '실행 중 (완료 후 다음 예약)'
                  : nextBatchAt !== null
                    ? `다음 실행 ${formatClockTime(nextBatchAt)}`
                    : ''}
              </span>
            )}
          </div>
        )}
        {busy && progress && (
          <span className="hint" data-testid="progress">
            {progress}
          </span>
        )}
        {!canCollect && <span className="hint">조건 설정에서 키워드를 저장하면 수집할 수 있습니다.</span>}
      </div>
      {showSummary && (
        <div className="summary">
          {lines?.total && <p data-testid="summary">{lines.total}</p>}
          {lines?.perSite.map(({ site, text }) => (
            <p key={site} data-testid="site-summary">
              {siteName(site)}: {text}
            </p>
          ))}
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
          {notices.map((notice) => (
            <p key={`${notice.site}:${notice.keyword ?? ''}:${notice.text}`} role="alert" className="warn notice-line">
              <span>{notice.text}</span>
              {notice.continuable && onContinueCollect && (
                <button type="button" onClick={() => onContinueCollect(notice.site, notice.keyword)} disabled={busy || !canCollect}>
                  계속 수집
                </button>
              )}
            </p>
          ))}
        </div>
      )}
    </header>
  )
}
