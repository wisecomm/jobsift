import type { SiteAdapter } from '../adapter/schema'
import type { JobPosting, SearchCriteria, StopReason } from '../shared/types'
import { buildSearchUrl } from './buildSearchUrl'
import { extractPage } from './extractPostings'


export interface CollectDeps {
  fetchHtml: (url: string) => Promise<string>
  knownIds: ReadonlySet<string>
  /** Postings posted before this instant end the keyword's scan. */
  cutoffFor: (keyword: string) => Date
  /** A keyword that has never completed a run scans down to its cutoff even past known postings, since criteria changes leave known ids scattered through the results. */
  scanPastKnown?: (keyword: string) => boolean
  sleep?: (ms: number) => Promise<void>
  maxPages?: number
}

export interface CollectResult {
  postings: JobPosting[]
  stopReasons: Record<string, StopReason>
  /** Keywords whose scan failed, with the message. Their postings are withheld so the next run rescans them whole. */
  errors: Record<string, string>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function collect(
  adapter: SiteAdapter,
  criteria: SearchCriteria,
  deps: CollectDeps,
): Promise<CollectResult> {
  const { fetchHtml, knownIds, cutoffFor, scanPastKnown, sleep = defaultSleep } = deps
  const maxPages = deps.maxPages ?? adapter.search.maxPages
  const byId = new Map<string, JobPosting>()
  const stopReasons: Record<string, StopReason> = {}
  const errors: Record<string, string> = {}
  let requested = false

  for (const keyword of criteria.keywords) {
    const cutoff = cutoffFor(keyword).getTime()
    const found = new Map<string, JobPosting>()
    let reason: StopReason = 'page-cap'
    try {
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
          else if (knownIds.has(posting.externalId)) {
            if (!scanPastKnown?.(keyword)) pageStop ??= 'known'
          } else found.set(posting.externalId, posting)
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
    } catch (error) {
      stopReasons[keyword] = 'error'
      errors[keyword] = error instanceof Error ? error.message : String(error)
      continue
    }
    stopReasons[keyword] = reason
    for (const [id, posting] of found) if (!byId.has(id)) byId.set(id, posting)
  }

  const postings = [...byId.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
  return { postings, stopReasons, errors }
}
