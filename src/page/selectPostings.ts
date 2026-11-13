import type { PostingStatus, StoredPosting } from '../shared/types'

export const PAGE_SIZE = 10

export type StatusTab = PostingStatus | 'all'
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
  /** Postings that pass every filter except the status tab, so each tab shows how many it would list. */
  counts: Record<StatusTab, number>
}

export const INITIAL_VIEW: ListView = { status: 'new', site: 'all', career: 'all', query: '', page: 1 }

const CAREER_KINDS: Record<Exclude<CareerOption, 'all'>, ReadonlySet<string>> = {
  newOk: new Set(['new', 'newOrExperienced', 'any']),
  experienced: new Set(['experienced', 'newOrExperienced']),
  any: new Set(['any']),
}

function matchesFilters(p: StoredPosting, { site, career, query }: ListView): boolean {
  if (site !== 'all' && p.site !== site) return false
  if (career !== 'all' && !CAREER_KINDS[career].has(p.career.kind)) return false
  const needle = query.trim().toLowerCase()
  return needle === '' || p.title.toLowerCase().includes(needle) || p.company.toLowerCase().includes(needle)
}

function compare(a: StoredPosting, b: StoredPosting): number {
  if (a.score !== b.score) {
    if (a.score === null) return 1
    if (b.score === null) return -1
    return b.score - a.score
  }
  return Date.parse(b.postedAt) - Date.parse(a.postedAt) || a.externalId.localeCompare(b.externalId)
}

export function selectPostings(postings: readonly StoredPosting[], view: ListView): Selection {
  const filtered = postings.filter((p) => matchesFilters(p, view))
  const counts: Record<StatusTab, number> = { new: 0, saved: 0, applied: 0, dismissed: 0, expired: 0, all: filtered.length }
  for (const p of filtered) counts[p.status]++

  const inTab = (view.status === 'all' ? filtered : filtered.filter((p) => p.status === view.status)).sort(compare)
  const totalPages = Math.max(1, Math.ceil(inTab.length / PAGE_SIZE))
  const page = Math.min(Math.max(1, Math.trunc(view.page) || 1), totalPages)
  return { rows: inTab.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE), page, totalPages, counts }
}
