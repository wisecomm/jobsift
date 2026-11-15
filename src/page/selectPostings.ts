import { postingSources, type PostingStatus, type StoredPosting } from '../shared/types'

export const PAGE_SIZE = 10

export type StatusTab = PostingStatus | 'active' | 'all'
export type CareerOption = 'all' | 'newOk' | 'experienced' | 'any'

export interface ListView {
  status: StatusTab
  /** A site id, or `all`. */
  site: string
  career: CareerOption
  query: string
  /** 1-based; clamped to the last page when the result is shorter. */
  page: number
}

export interface Selection {
  rows: StoredPosting[]
  page: number
  totalPages: number
  totalItems: number
  activeCount: number
  /** Postings that pass every filter except the status tab, so each tab shows how many it would list. */
  counts: Record<PostingStatus | 'all', number>
}

export const INITIAL_VIEW: ListView = { status: 'new', site: 'all', career: 'all', query: '', page: 1 }

const CAREER_KINDS: Record<Exclude<CareerOption, 'all'>, ReadonlySet<string>> = {
  newOk: new Set(['new', 'newOrExperienced', 'any']),
  experienced: new Set(['experienced', 'newOrExperienced']),
  any: new Set(['any']),
}

function matchesFilters(p: StoredPosting, { site, career, query }: ListView): boolean {
  if (site !== 'all' && !postingSources(p).some((s) => s.site === site)) return false
  if (career !== 'all' && !CAREER_KINDS[career].has(p.career.kind)) return false
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return (
    p.title.toLowerCase().includes(needle) ||
    p.company.toLowerCase().includes(needle) ||
    p.locations.some((loc) => loc.toLowerCase().includes(needle)) ||
    p.matchedKeywords.some((kw) => kw.toLowerCase().includes(needle))
  )
}

function compare(a: StoredPosting, b: StoredPosting): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1
    if (b.score === null) return -1
    return b.score - a.score
  }
  return (
    Date.parse(b.collectedAt) - Date.parse(a.collectedAt) ||
    Date.parse(b.postedAt) - Date.parse(a.postedAt) ||
    a.externalId.localeCompare(b.externalId)
  )
}

export function selectPostings(postings: readonly StoredPosting[], view: ListView): Selection {
  const filtered = postings.filter((p) => matchesFilters(p, view))
  const counts: Record<PostingStatus | 'all', number> = {
    new: 0,
    saved: 0,
    applied: 0,
    dismissed: 0,
    expired: 0,
    all: filtered.length,
  }
  for (const p of filtered) counts[p.status]++

  const activeCount = counts.new + counts.saved + counts.applied
  const inTab = (
    view.status === 'all'
      ? filtered
      : view.status === 'active'
        ? filtered.filter((p) => p.status !== 'dismissed' && p.status !== 'expired')
        : filtered.filter((p) => p.status === view.status)
  ).sort(compare)

  const totalItems = inTab.length
  const totalPages = Math.max(1, Math.ceil(totalItems / PAGE_SIZE))
  const page = Math.min(Math.max(1, Math.trunc(view.page) || 1), totalPages)
  return {
    rows: inTab.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE),
    page,
    totalPages,
    totalItems,
    activeCount,
    counts,
  }
}
