import { PAGE_SIZE } from './selectPostings'

interface Props {
  page: number
  totalPages: number
  totalItems: number
  pageSize?: number
  sortLabel?: string
  onPage: (page: number) => void
}

export const NAV_PAGE_WINDOW = 5

/** Returns up to `size` consecutive page numbers centered around `page`. */
export function pageWindow(page: number, totalPages: number, size = NAV_PAGE_WINDOW): number[] {
  if (totalPages <= 0) return []
  const count = Math.min(totalPages, size)
  const start = Math.max(1, Math.min(page - Math.floor(count / 2), totalPages - count + 1))
  return Array.from({ length: count }, (_, i) => start + i)
}

export function Pager({ page, totalPages, totalItems, pageSize = PAGE_SIZE, sortLabel = '최신 수집일 순', onPage }: Props) {
  if (totalItems <= 0) return null
  const startItem = (page - 1) * pageSize + 1
  const endItem = Math.min(page * pageSize, totalItems)
  const pages = pageWindow(page, totalPages, NAV_PAGE_WINDOW)

  return (
    <div className="pager-bar">
      <p className="pager-summary">
        전체 <strong>{totalItems.toLocaleString('ko-KR')}</strong>건 중{' '}
        <strong>
          {startItem}–{endItem}
        </strong>
        번째 ({sortLabel})
      </p>
      <nav className="pager" aria-label="페이지 이동">
        <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}>
          이전
        </button>
        {pages.map((n) => (
          <button
            key={n}
            type="button"
            onClick={() => onPage(n)}
            aria-current={n === page ? 'page' : undefined}
            aria-label={`${n}페이지`}
            className={n === page ? 'current' : undefined}
          >
            {n}
          </button>
        ))}
        <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
          다음
        </button>
      </nav>
    </div>
  )
}
