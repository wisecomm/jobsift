import type { SiteAdapter } from '../adapter/schema'
import type { JobPosting, SearchCriteria } from '../shared/types'
import { buildSearchUrl } from './buildSearchUrl'
import { extractPage } from './extractPostings'

const DAY_MS = 24 * 60 * 60 * 1000

export type StopReason = 'cutoff' | 'known' | 'exhausted' | 'page-cap'

export interface CollectDeps {
  fetchHtml: (url: string) => Promise<string>
  knownIds: ReadonlySet<string>
  now: Date
  sleep?: (ms: number) => Promise<void>
  maxPages?: number
}

export interface CollectResult {
  postings: JobPosting[]
  stopReasons: Record<string, StopReason>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function collect(
  adapter: SiteAdapter,
  criteria: SearchCriteria,
  deps: CollectDeps,
): Promise<CollectResult> {
  const { fetchHtml, knownIds, now, sleep = defaultSleep } = deps
  const maxPages = deps.maxPages ?? adapter.search.maxPages
  const cutoff = now.getTime() - criteria.initialDays * DAY_MS
  const byId = new Map<string, JobPosting>()
  const stopReasons: Record<string, StopReason> = {}
  let requested = false

  for (const keyword of criteria.keywords) {
    let reason: StopReason = 'page-cap'
    for (let n = 0; n < maxPages; n++) {
      if (requested) await sleep(adapter.search.requestDelayMs)
      requested = true
      const page = adapter.search.firstPage + n
      const html = await fetchHtml(buildSearchUrl(adapter, criteria, keyword, page))
      const { postings, totalPages } = extractPage(adapter, html)

      // The site's order is not guaranteed to be strict, so one stale item must not hide fresh ones after it on the same page.
      let pageStop: StopReason | null = null
      for (const posting of postings) {
        if (Date.parse(posting.postedAt) < cutoff) pageStop ??= 'cutoff'
        else if (knownIds.has(posting.externalId)) pageStop ??= 'known'
        else if (!byId.has(posting.externalId)) byId.set(posting.externalId, posting)
      }
      if (pageStop) {
        reason = pageStop
        break
      }
      if (postings.length === 0 || (totalPages !== null && n + 1 >= totalPages)) {
        reason = 'exhausted'
        break
      }
    }
    stopReasons[keyword] = reason
  }

  const postings = [...byId.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
  return { postings, stopReasons }
}
