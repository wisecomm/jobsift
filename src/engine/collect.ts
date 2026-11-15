import type { SiteAdapter } from '../adapter/schema'
import { kstDay } from '../shared/date'
import type { JobPosting, SearchCriteria, StopReason } from '../shared/types'
import { buildSearchUrl } from './buildSearchUrl'
import { extractPage } from './extractPostings'


export interface CollectProgress {
  keyword: string
  page: number
  maxPages: number
  collected: number
}

export interface CollectDeps {
  fetchHtml: (url: string) => Promise<string>
  knownIds: ReadonlySet<string>
  /** Current instant; when provided, already-expired postings do not count toward `maxItems`. */
  now?: Date
  /** Postings posted before this instant end the keyword's scan. `null` disables the date cutoff. */
  cutoffFor?: (keyword: string) => Date | null
  /** A keyword that has never completed a run scans down to its cutoff even past known postings, since criteria changes leave known ids scattered through the results. */
  scanPastKnown?: (keyword: string) => boolean
  /** First page number to scan for this keyword (defaults to `adapter.search.firstPage`). */
  startPageFor?: (keyword: string) => number | undefined
  /** Skip already-known ids without advancing `maxItems` or stopping on `known` (used when continuing past a page cap). */
  skipKnownInCap?: (keyword: string) => boolean
  sleep?: (ms: number) => Promise<void>
  maxPages?: number
  /** Per-keyword scan cap in postings. Overrides `adapter.search.maxPages` when `maxPages` is omitted. */
  maxItems?: number
  signal?: AbortSignal
  onProgress?: (progress: CollectProgress) => void
}

export interface CollectResult {
  postings: JobPosting[]
  stopReasons: Record<string, StopReason>
  /** Next page number to resume from for keywords that stopped with `page-cap`. */
  nextPages: Record<string, number>
  /** Keywords whose scan failed, with the message. Their postings are withheld so the next run rescans them whole. */
  errors: Record<string, string>
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function collect(
  adapter: SiteAdapter,
  criteria: SearchCriteria,
  deps: CollectDeps,
): Promise<CollectResult> {
  const { fetchHtml, knownIds, now, cutoffFor, scanPastKnown, startPageFor, skipKnownInCap, sleep = defaultSleep, signal, onProgress } = deps
  const maxItems = deps.maxItems !== undefined ? Math.max(1, Math.round(deps.maxItems)) : undefined
  const baseMaxPages =
    deps.maxPages ??
    (now !== undefined
      ? adapter.search.maxPages
      : maxItems !== undefined
        ? Math.ceil(maxItems / adapter.search.pageSize)
        : adapter.search.maxPages)
  const nowMs = now?.getTime()
  const isExpired = (posting: JobPosting): boolean =>
    nowMs !== undefined && posting.deadline !== null && Date.parse(posting.deadline) < nowMs
  const byId = new Map<string, JobPosting>()
  const stopReasons: Record<string, StopReason> = {}
  const nextPages: Record<string, number> = {}
  const errors: Record<string, string> = {}
  let requested = false

  const dateOnly = adapter.postedAtPrecision === 'date'
  const isBeforeCutoff = (postedAtMs: number, cutoffMs: number) =>
    dateOnly ? kstDay(postedAtMs) < kstDay(cutoffMs) : postedAtMs < cutoffMs

  for (const keyword of criteria.keywords) {
    if (signal?.aborted) break
    const cutoff = cutoffFor?.(keyword)?.getTime() ?? null
    const startPage = Math.max(adapter.search.firstPage, Math.round(startPageFor?.(keyword) ?? adapter.search.firstPage))
    const skipKnown = skipKnownInCap?.(keyword) ?? false
    const maxPages = deps.maxPages === undefined && skipKnown ? baseMaxPages + 1 : baseMaxPages
    const found = new Map<string, JobPosting>()
    let reason: StopReason = 'page-cap'
    let nextPage = startPage
    let scanned = 0
    const stopIfAborted = () => {
      if (!signal?.aborted) return false
      reason = 'error'
      errors[keyword] = '사용자가 수집을 중단했습니다.'
      return true
    }
    try {
      for (let n = 0; n < maxPages; n++) {
        if (stopIfAborted()) break
        if (requested) await sleep(adapter.search.requestDelayMs)
        if (stopIfAborted()) break
        requested = true
        onProgress?.({ keyword, page: n + 1, maxPages, collected: byId.size + found.size })
        if (stopIfAborted()) break
        const page = startPage + n
        nextPage = page + 1
        const html = await fetchHtml(buildSearchUrl(adapter, criteria, keyword, page))
        if (stopIfAborted()) break
        const { postings, totalPages, modifiedIds } = extractPage(adapter, html)

        // The site's order is not guaranteed to be strict, so one stale item must not hide fresh ones after it on the same page.
        let pageStop: StopReason | null = null
        for (const posting of postings) {
          if (skipKnown && knownIds.has(posting.externalId)) continue
          if (cutoff !== null && isBeforeCutoff(Date.parse(posting.postedAt), cutoff)) {
            pageStop ??= 'cutoff'
            continue
          }
          const expired = isExpired(posting)
          if (!expired && maxItems !== undefined && scanned >= maxItems) {
            if (!pageStop) {
              pageStop = 'page-cap'
              nextPage = page
            }
            break
          }
          if (!expired) scanned++
          if (knownIds.has(posting.externalId)) {
            if (!scanPastKnown?.(keyword) && !modifiedIds?.has(posting.externalId)) pageStop ??= 'known'
          } else found.set(posting.externalId, posting)
        }
        if (pageStop) {
          reason = pageStop
          break
        }
        if (postings.length === 0 || (totalPages !== null && page >= adapter.search.firstPage + totalPages - 1)) {
          reason = 'exhausted'
          break
        }
        if (maxItems !== undefined && scanned >= maxItems) {
          reason = 'page-cap'
          break
        }
      }
    } catch (error) {
      stopReasons[keyword] = 'error'
      errors[keyword] = signal?.aborted ? '사용자가 수집을 중단했습니다.' : error instanceof Error ? error.message : String(error)
      if (signal?.aborted) {
        for (const [id, posting] of found) if (!byId.has(id)) byId.set(id, posting)
      }
      continue
    }
    stopReasons[keyword] = reason
    if (reason === 'page-cap') nextPages[keyword] = nextPage
    for (const [id, posting] of found) if (!byId.has(id)) byId.set(id, posting)
  }

  const postings = [...byId.values()].sort((a, b) => Date.parse(b.postedAt) - Date.parse(a.postedAt))
  return { postings, stopReasons, nextPages, errors }
}
