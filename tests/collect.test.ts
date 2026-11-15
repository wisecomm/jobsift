import { describe, expect, it } from 'vitest'
import { collect } from '../src/engine/collect'
import { adapter, criteria, fakePage, fixtureHtml } from './helpers'

const NOW = new Date('2026-11-13T20:00:00+09:00')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

function server(pages: Record<string, string>) {
  const requested: string[] = []
  const delays: number[] = []
  return {
    requested,
    delays,
    deps: {
      fetchHtml: async (url: string) => {
        requested.push(url)
        const page = pages[url]
        if (page === undefined) throw new Error(`unexpected request ${url}`)
        return page
      },
      sleep: async (ms: number) => void delays.push(ms),
      knownIds: new Set<string>(),
      cutoffFor: daysBack(7),
    },
  }
}

const daysBack = (days: number) => () => new Date(NOW.getTime() - days * 86_400_000)

const pageUrl = (keyword: string, page: number) =>
  `https://www.jobkorea.co.kr/Search/?stext=${encodeURIComponent(keyword)}&tabType=recruit&ord=RegDtDesc&Page_No=${page}`

describe('collect', () => {
  it('stops after the page that reaches the age cutoff and does not fetch further', async () => {
    const s = server({
      [pageUrl('전산', 1)]: fakePage([{ id: '1', createdAt: hoursAgo(1) }, { id: '2', createdAt: hoursAgo(5) }], 9),
      [pageUrl('전산', 2)]: fakePage(
        [{ id: '3', createdAt: hoursAgo(20) }, { id: '4', createdAt: hoursAgo(30) }, { id: '5', createdAt: hoursAgo(31) }],
        9,
      ),
    })
    const result = await collect(adapter, criteria(), { ...s.deps, cutoffFor: daysBack(1) })
    expect(result.postings.map((p) => p.externalId)).toEqual(['1', '2', '3'])
    expect(s.requested).toHaveLength(2)
    expect(result.stopReasons).toEqual({ 전산: 'cutoff' })
  })

  it('stops after the page that reaches a known id and skips only the known posting', async () => {
    const s = server({
      [pageUrl('전산', 1)]: fakePage(
        [{ id: '1', createdAt: hoursAgo(1) }, { id: '2', createdAt: hoursAgo(2) }, { id: '3', createdAt: hoursAgo(3) }],
        9,
      ),
    })
    const result = await collect(adapter, criteria(), { ...s.deps, knownIds: new Set(['2']) })
    expect(result.postings.map((p) => p.externalId)).toEqual(['1', '3'])
    expect(result.stopReasons).toEqual({ 전산: 'known' })
    expect(s.requested).toHaveLength(1)
  })

  it('keeps a fresh posting that follows a stale one on the same page', async () => {
    const s = server({
      [pageUrl('전산', 1)]: fakePage(
        [{ id: '1', createdAt: hoursAgo(1) }, { id: '2', createdAt: hoursAgo(90) }, { id: '3', createdAt: hoursAgo(2) }],
        9,
      ),
    })
    const result = await collect(adapter, criteria(), { ...s.deps, cutoffFor: daysBack(1) })
    expect(result.postings.map((p) => p.externalId)).toEqual(['1', '3'])
    expect(s.requested).toHaveLength(1)
  })

  it('merges two keywords by externalId and waits between every request', async () => {
    const s = server({
      [pageUrl('전산', 1)]: fakePage([{ id: '1', createdAt: hoursAgo(1) }, { id: '2', createdAt: hoursAgo(3) }], 1),
      [pageUrl('회계', 1)]: fakePage([{ id: '2', createdAt: hoursAgo(3) }, { id: '3', createdAt: hoursAgo(2) }], 1),
    })
    const result = await collect(adapter, criteria({ keywords: ['전산', '회계'] }), s.deps)
    expect(result.postings.map((p) => p.externalId)).toEqual(['1', '3', '2'])
    expect(result.stopReasons).toEqual({ 전산: 'exhausted', 회계: 'exhausted' })
    expect(s.delays).toEqual([adapter.search.requestDelayMs])
  })

  it('stops at the hard page cap', async () => {
    const pages = Object.fromEntries(
      [1, 2, 3].map((n) => [pageUrl('전산', n), fakePage([{ id: String(n), createdAt: hoursAgo(n) }], 99)]),
    )
    const s = server(pages)
    const result = await collect(adapter, criteria(), { ...s.deps, maxPages: 3 })
    expect(s.requested).toHaveLength(3)
    expect(result.stopReasons).toEqual({ 전산: 'page-cap' })
  })

  it('stops at maxItems when more postings remain, and finishes as exhausted when totalPages ends exactly at the limit', async () => {
    const page1Items = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 1), createdAt: hoursAgo(i + 1) }))
    const page2Items = Array.from({ length: 20 }, (_, i) => ({ id: String(i + 21), createdAt: hoursAgo(i + 21) }))
    const sMore = server({
      [pageUrl('전산', 1)]: fakePage(page1Items, 5),
      [pageUrl('전산', 2)]: fakePage(page2Items, 5),
    })
    const capped = await collect(adapter, criteria(), { ...sMore.deps, maxItems: 25 })
    expect(capped.postings).toHaveLength(25)
    expect(capped.stopReasons).toEqual({ 전산: 'page-cap' })

    const sExact = server({ [pageUrl('전산', 1)]: fakePage(page1Items, 1) })
    const exact = await collect(adapter, criteria(), { ...sExact.deps, maxItems: 20 })
    expect(exact.postings).toHaveLength(20)
    expect(exact.stopReasons).toEqual({ 전산: 'exhausted' })
  })

  it('stops when a page comes back empty', async () => {
    const s = server({ [pageUrl('전산', 1)]: fakePage([], 99) })
    const result = await collect(adapter, criteria(), s.deps)
    expect(result.postings).toEqual([])
    expect(result.stopReasons).toEqual({ 전산: 'exhausted' })
  })

  it('collects without a date cutoff when cutoffFor returns null', async () => {
    const s = server({
      [pageUrl('전산', 1)]: fakePage([{ id: '1', createdAt: hoursAgo(24 * 90) }], 1),
    })
    const result = await collect(adapter, criteria(), { ...s.deps, cutoffFor: () => null })
    expect(result.postings.map((p) => p.externalId)).toEqual(['1'])
    expect(result.stopReasons).toEqual({ 전산: 'exhausted' })
  })

  it('collects the real fixture page as one page of postings', async () => {
    const s = server({ [pageUrl('전산', 1)]: fixtureHtml })
    const result = await collect(adapter, criteria(), {
      ...s.deps,
      cutoffFor: () => new Date('2026-11-12T20:30:00+09:00'),
      maxPages: 1,
    })
    expect(result.postings).toHaveLength(20)
  })

  it('reports page progress and stops cleanly when aborted mid-scan', async () => {
    const ac = new AbortController()
    const pages: number[] = []
    const s = server({
      [pageUrl('전산', 1)]: fakePage([{ id: '1', createdAt: hoursAgo(1) }], 5),
      [pageUrl('전산', 2)]: fakePage([{ id: '2', createdAt: hoursAgo(2) }], 5),
    })
    const result = await collect(adapter, criteria(), {
      ...s.deps,
      signal: ac.signal,
      onProgress: ({ page }) => {
        pages.push(page)
        if (page === 2) ac.abort()
      },
    })
    expect(pages).toEqual([1, 2])
    expect(result.postings.map((p) => p.externalId)).toEqual(['1'])
    expect(result.stopReasons).toEqual({ 전산: 'error' })
    expect(result.errors.전산).toBe('사용자가 수집을 중단했습니다.')
  })

  it('excludes expired postings from the maxItems count when now is provided', async () => {
    const pastDeadline = '2026-11-10T00:00:00+09:00'
    const openDeadline = '2026-12-01T00:00:00+09:00'
    const s = server({
      [pageUrl('전산', 1)]: fakePage(
        [
          { id: '1', createdAt: hoursAgo(1), deadline: pastDeadline },
          { id: '2', createdAt: hoursAgo(2), deadline: pastDeadline },
          { id: '3', createdAt: hoursAgo(3), deadline: openDeadline },
        ],
        2,
      ),
      [pageUrl('전산', 2)]: fakePage(
        [
          { id: '4', createdAt: hoursAgo(4), deadline: openDeadline },
          { id: '5', createdAt: hoursAgo(5), deadline: openDeadline },
        ],
        2,
      ),
    })
    const result = await collect(adapter, criteria(), { ...s.deps, now: NOW, maxItems: 2 })
    expect(result.postings.map((p) => p.externalId)).toEqual(['1', '2', '3', '4'])
    expect(result.stopReasons).toEqual({ 전산: 'page-cap' })
  })
})
