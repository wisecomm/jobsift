import { useMemo, useState } from 'react'
import { postingSources, type PostingKey, type PostingPatch, type StoredPosting } from '../shared/types'
import { Pager } from './Pager'
import { PostingCard } from './PostingCard'
import { INITIAL_VIEW, selectPostings, type CareerOption, type ListView } from './selectPostings'
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
  { value: 'all', label: '전체' },
  { value: 'newOk', label: '신입 가능' },
  { value: 'experienced', label: '경력' },
  { value: 'any', label: '경력무관' },
]

export function PostingsView({ postings, hasCriteria, siteOrder, onUpdate, onOpenSettings }: Props) {
  const [view, setView] = useState<ListView>(INITIAL_VIEW)
  const change = (patch: Partial<ListView>) => setView((v) => ({ ...v, ...patch, page: 1 }))
  const selection = useMemo(() => selectPostings(postings, view), [postings, view])
  const sites = useMemo(() => {
    const present = [...new Set(postings.flatMap((p) => postingSources(p).map((s) => s.site)))]
    return present.sort((a, b) => {
      const ia = siteOrder.indexOf(a)
      const ib = siteOrder.indexOf(b)
      return (ia === -1 ? Number.MAX_SAFE_INTEGER : ia) - (ib === -1 ? Number.MAX_SAFE_INTEGER : ib)
    })
  }, [postings, siteOrder])
  const filtered = view.site !== 'all' || view.career !== 'all' || view.query.trim() !== ''
  const now = new Date()

  return (
    <section aria-label="공고">
      <div className="status-tabs">
        {STATUS_TABS.map(({ status, label }) => (
          <button key={status} type="button" aria-pressed={view.status === status} onClick={() => change({ status })}>
            {label} <span className="count">{selection.counts[status]}</span>
          </button>
        ))}
      </div>

      <div className="filters">
        <label>
          사이트
          <select value={view.site} onChange={(e) => change({ site: e.target.value })}>
            <option value="all">전체</option>
            {sites.map((site) => (
              <option key={site} value={site}>
                {siteName(site)}
              </option>
            ))}
          </select>
        </label>
        <label>
          경력
          <select value={view.career} onChange={(e) => change({ career: e.target.value as CareerOption })}>
            {CAREER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label className="grow">
          검색
          <input type="search" value={view.query} placeholder="제목이나 회사 이름" onChange={(e) => change({ query: e.target.value })} />
        </label>
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
          onResetFilters={() => change({ site: 'all', career: 'all', query: '' })}
          onOpenSettings={onOpenSettings}
        />
      )}
      <Pager page={selection.page} totalPages={selection.totalPages} onPage={(page) => setView((v) => ({ ...v, page }))} />
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
