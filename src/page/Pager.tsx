interface Props {
  page: number
  totalPages: number
  onPage: (page: number) => void
}

function pageNumbers(page: number, total: number): (number | 'gap')[] {
  const wanted = new Set([1, total, page - 1, page, page + 1])
  const sorted = [...wanted].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b)
  return sorted.flatMap((n, i) => (i > 0 && n - sorted[i - 1]! > 1 ? ['gap' as const, n] : [n]))
}

export function Pager({ page, totalPages, onPage }: Props) {
  if (totalPages <= 1) return null
  return (
    <nav className="pager" aria-label="페이지 이동">
      <button type="button" onClick={() => onPage(page - 1)} disabled={page <= 1}>
        이전
      </button>
      {pageNumbers(page, totalPages).map((n, i) =>
        n === 'gap' ? (
          <span key={`gap-${i}`} aria-hidden="true">…</span>
        ) : (
          <button key={n} type="button" onClick={() => onPage(n)} aria-current={n === page ? 'page' : undefined} aria-label={`${n}페이지`} className={n === page ? 'current' : undefined}>
            {n}
          </button>
        ),
      )}
      <button type="button" onClick={() => onPage(page + 1)} disabled={page >= totalPages}>
        다음
      </button>
    </nav>
  )
}
