import { useMemo, useState } from 'react'
import { EMPLOYMENT_TYPE_OPTIONS } from '../shared/employment'
import { postingSources, type PostingKey, type PostingPatch, type StoredPosting } from '../shared/types'
import { Pager } from './Pager'
import { PostingCard } from './PostingCard'
import { INITIAL_VIEW, PAGE_SIZE, selectPostings, type CareerOption, type EmploymentOption, type ListView } from './selectPostings'
import { siteName } from './sites'
import { STATUS_TABS } from './statuses'

interface Props {
  postings: StoredPosting[]
  hasCriteria: boolean
  siteOrder: readonly string[]
  onUpdate: (key: PostingKey, patch: PostingPatch) => void
  onOpenSettings: () => void
}

const CAREER_OPTIONS: { value: CareerOption; label: string }[] = [
  { value: 'all', label: '경력 전체' },
  { value: 'newOk', label: '신입 가능' },
  { value: 'experienced', label: '경력' },
  { value: 'any', label: '경력무관' },
]

export function PostingsView({ postings, hasCriteria, siteOrder, onUpdate, onOpenSettings }: Props) {
  const [view, setView] = useState<ListView>(INITIAL_VIEW)
  const change = (patch: Partial<ListView>) => setView((v) => ({ ...v, ...patch, page: 1 }))
  const selection = useMemo(() => selectPostings(postings, view), [postings, view])
  const kpi = useMemo(() => {
    const counts = { new: 0, active: 0, saved: 0, applied: 0, dismissed: 0, expired: 0 }
    for (const p of postings) {
      counts[p.status]++
      if (p.status !== 'dismissed' && p.status !== 'expired') counts.active++
    }
    return counts
  }, [postings])

  const sites = useMemo(() => {
    const present = [...new Set(postings.flatMap((p) => postingSources(p).map((s) => s.site)))]
    return present.sort((a, b) => {
      const ia = siteOrder.indexOf(a)
      const ib = siteOrder.indexOf(b)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
  }, [postings, siteOrder])

  const filtered = view.site !== 'all' || view.career !== 'all' || view.employmentType !== 'all' || view.query.trim() !== ''
  const now = new Date()

  return (
    <section aria-label="공고" className="postings-section">
      <div className="kpi-grid" aria-label="공고 현황 요약">
        <div className="kpi-card">
          <span className="kpi-label">신규 미확인 공고</span>
          <strong className="kpi-value kpi-new">{kpi.new.toLocaleString('ko-KR')}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">전체 활성 공고</span>
          <strong className="kpi-value kpi-active">{kpi.active.toLocaleString('ko-KR')}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">관심 보관함</span>
          <strong className="kpi-value kpi-saved">{kpi.saved.toLocaleString('ko-KR')}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">지원 완료</span>
          <strong className="kpi-value kpi-applied">{kpi.applied.toLocaleString('ko-KR')}</strong>
        </div>
        <div className="kpi-card">
          <span className="kpi-label">확인완료 / 마감됨</span>
          <strong className="kpi-value kpi-archived">
            {kpi.dismissed.toLocaleString('ko-KR')} / {kpi.expired.toLocaleString('ko-KR')}
          </strong>
        </div>
      </div>

      <div className="toolbar-card">
        <div className="status-tabs" role="group" aria-label="상태 필터">
          {STATUS_TABS.map(({ status, label }) => (
            <button key={status} type="button" aria-pressed={view.status === status} onClick={() => change({ status })}>
              {label}
            </button>
          ))}
        </div>

        <select aria-label="사이트 필터" value={view.site} onChange={(e) => change({ site: e.target.value })}>
          <option value="all">모든 사이트</option>
          {sites.map((site) => (
            <option key={site} value={site}>
              {siteName(site)}
            </option>
          ))}
        </select>

        <select aria-label="경력 필터" value={view.career} onChange={(e) => change({ career: e.target.value as CareerOption })}>
          {CAREER_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <select
          aria-label="고용형태 필터"
          value={view.employmentType}
          onChange={(e) => change({ employmentType: e.target.value as EmploymentOption })}
        >
          <option value="all">고용형태 전체</option>
          {EMPLOYMENT_TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>

        <input
          className="toolbar-search"
          type="search"
          aria-label="공고 검색"
          value={view.query}
          placeholder="공고명, 기관/회사, 지역, 키워드 검색..."
          onChange={(e) => change({ query: e.target.value })}
        />

        <span className="toolbar-total">
          총 {selection.totalItems.toLocaleString('ko-KR')}건 ({selection.page}/{selection.totalPages}페이지)
        </span>
      </div>

      {selection.rows.length > 0 ? (
        <ul className="cards">
          {selection.rows.map((p) => (
            <PostingCard key={`${p.site}:${p.externalId}`} posting={p} now={now} onUpdate={onUpdate} />
          ))}
        </ul>
      ) : (
        <EmptyState
          hasCriteria={hasCriteria}
          nothingCollected={postings.length === 0}
          filtered={filtered}
          onResetFilters={() => change({ site: 'all', career: 'all', employmentType: 'all', query: '' })}
          onOpenSettings={onOpenSettings}
        />
      )}

      <Pager
        page={selection.page}
        totalPages={selection.totalPages}
        totalItems={selection.totalItems}
        pageSize={PAGE_SIZE}
        sortLabel="최신 수집일 · 최신 공고 ID 순"
        onPage={(page) => setView((v) => ({ ...v, page }))}
      />
    </section>
  )
}

function EmptyState(props: { hasCriteria: boolean; nothingCollected: boolean; filtered: boolean; onResetFilters: () => void; onOpenSettings: () => void }) {
  if (!props.hasCriteria && props.nothingCollected) {
    return (
      <div className="empty">
        <p>아직 찾을 조건이 없습니다.</p>
        <p>조건 설정에서 키워드를 입력하고 저장한 뒤 "지금 수집"을 눌러 주세요.</p>
        <button type="button" className="primary" onClick={props.onOpenSettings}>조건 설정으로 가기</button>
      </div>
    )
  }
  if (props.nothingCollected) {
    return (
      <div className="empty">
        <p>아직 수집한 공고가 없습니다.</p>
        <p>위의 "지금 수집" 버튼을 눌러 조건에 맞는 공고를 가져오세요.</p>
      </div>
    )
  }
  return (
    <div className="empty">
      <p>이 목록에 보여줄 공고가 없습니다.</p>
      {props.filtered ? (
        <button type="button" onClick={props.onResetFilters}>필터 지우기</button>
      ) : (
        <p>다른 탭을 확인하거나 "지금 수집"으로 새 공고를 가져오세요.</p>
      )}
    </div>
  )
}
