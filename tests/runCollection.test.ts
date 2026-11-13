import { describe, expect, it } from 'vitest'
import { runCollection } from '../src/engine/runCollection'
import type { DiscardRecord, StoredPosting } from '../src/shared/types'
import { adapter, criteria, fakePage, freshStore, posting, type FakeItem } from './helpers'

const NOW = new Date('2026-11-13T20:00:00+09:00')
const hoursAgo = (h: number, from = NOW) => new Date(from.getTime() - h * 3600_000).toISOString()
const pageUrl = (keyword: string, page = 1) => `${keyword}#${page}`
const pageKey = (url: string) => {
  const { searchParams } = new URL(url)
  return pageUrl(searchParams.get('stext') ?? '', Number(searchParams.get('Page_No')))
}

function site(pages: Record<string, string>, failing: string[] = []) {
  const requested: string[] = []
  return {
    requested,
    deps: (now: Date) => ({
      now,
      sleep: async () => {},
      fetchHtml: async (url: string) => {
        requested.push(pageKey(url))
        if (failing.some((keyword) => url.includes(encodeURIComponent(keyword)))) throw new Error('네트워크 오류')
        const page = pages[pageKey(url)]
        if (page === undefined) throw new Error(`unexpected request ${url}`)
        return page
      },
    }),
  }
}

const mixedItems: FakeItem[] = [
  { id: '1', createdAt: hoursAgo(1) },
  { id: '2', createdAt: hoursAgo(2), title: '회계 담당', tags: ',총무,' },
  { id: '3', createdAt: hoursAgo(3), areas: ['B010'] },
  { id: '4', createdAt: hoursAgo(4), deadline: '2026-11-01T00:00:00+09:00' },
  { id: '5', createdAt: hoursAgo(5), careerType: '2' },
  { id: '6', createdAt: hoursAgo(6), title: '전산 영업' },
]
const rules = criteria({ locations: ['서울'], career: 'new', excludeKeywords: ['영업'] })

const stored = (id: string, overrides: Partial<StoredPosting> = {}): StoredPosting => ({
  ...posting({ externalId: id }),
  status: 'new',
  memo: '',
  matchedKeywords: ['전산'],
  score: null,
  scoreReason: null,
  collectedAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...overrides,
})

describe('runCollection', () => {
  it('saves passes, discards rejects, and counts every outcome', async () => {
    const store = await freshStore()
    const s = site({ [pageUrl('전산')]: fakePage(mixedItems, 1) })
    const summary = await runCollection(adapter, rules, store, s.deps(NOW))

    expect(summary).toMatchObject({
      scanned: 6,
      saved: 1,
      discarded: 5,
      discardedByGate: { expired: 1, excludeKeyword: 1, keywordMismatch: 1, location: 1, career: 1 },
      expiredMarked: 0,
      stopReasons: { 전산: 'exhausted' },
    })
    const kept = await store.listPostings('jobkorea')
    expect(kept.map((p) => [p.externalId, p.status, p.matchedKeywords])).toEqual([['1', 'new', ['전산']]])
    expect((await store.listDiscards('jobkorea')).map((d) => d.externalId).sort()).toEqual(['2', '3', '4', '5', '6'])
    expect(await store.getCollectState('jobkorea', '전산')).toMatchObject({ lastCollectedAt: NOW.toISOString() })
  })

  it('a second run with the same pages fetches one page and changes nothing', async () => {
    const store = await freshStore()
    const s = site({
      [pageUrl('전산')]: fakePage(mixedItems, 3),
      [pageUrl('전산', 2)]: fakePage([{ id: '8', createdAt: hoursAgo(24 * 10) }], 3),
    })
    await runCollection(adapter, rules, store, s.deps(NOW))
    expect(s.requested).toHaveLength(2)
    const before = { postings: await store.listPostings('jobkorea'), discards: await store.listDiscards('jobkorea') }
    s.requested.length = 0

    const later = new Date(NOW.getTime() + 3600_000)
    const summary = await runCollection(adapter, rules, store, s.deps(later))

    expect(s.requested).toEqual([pageUrl('전산')])
    expect(summary).toMatchObject({ scanned: 0, saved: 0, discarded: 0, expiredMarked: 0 })
    expect(await store.listPostings('jobkorea')).toEqual(before.postings)
    // The expired posting's discard is pruned because its deadline has passed; the rest stay.
    expect(await store.listDiscards('jobkorea')).toEqual(before.discards.filter((d) => d.externalId !== '4'))
  })

  it('keeps a user-set status and memo when the posting is collected again', async () => {
    const store = await freshStore()
    await store.putPosting(stored('1', { status: 'applied', memo: '지원 완료' }))
    const s = site({ [pageUrl('전산')]: fakePage([{ id: '1', createdAt: hoursAgo(1) }, { id: '7', createdAt: hoursAgo(2) }], 1) })

    const summary = await runCollection(adapter, criteria(), store, s.deps(NOW))

    expect(summary.saved).toBe(1)
    expect(await store.getPosting({ site: 'jobkorea', externalId: '1' })).toMatchObject({ status: 'applied', memo: '지원 완료' })
  })

  it('leaves lastCollectedAt unset for a keyword whose fetch failed, and withholds its postings', async () => {
    const store = await freshStore()
    const s = site(
      {
        [pageUrl('전산')]: fakePage([{ id: '1', createdAt: hoursAgo(1) }], 1),
        [pageUrl('회계')]: fakePage([{ id: '2', createdAt: hoursAgo(1), title: '회계 담당' }], 1),
      },
      ['회계'],
    )
    const summary = await runCollection(adapter, criteria({ keywords: ['전산', '회계'] }), store, s.deps(NOW))

    expect(summary.stopReasons).toEqual({ 전산: 'exhausted', 회계: 'error' })
    expect(summary.errors).toEqual({ 회계: '네트워크 오류' })
    expect(await store.getCollectState('jobkorea', '전산')).toBeDefined()
    expect(await store.getCollectState('jobkorea', '회계')).toBeUndefined()
    expect((await store.listPostings('jobkorea')).map((p) => p.externalId)).toEqual(['1'])
  })

  it('uses each keyword\'s own lastCollectedAt as its cutoff', async () => {
    const store = await freshStore()
    await store.putCollectState({ site: 'jobkorea', keyword: '전산', lastCollectedAt: hoursAgo(2) })
    const s = site({
      [pageUrl('전산')]: fakePage([{ id: '1', createdAt: hoursAgo(1) }, { id: '2', createdAt: hoursAgo(3) }], 9),
      [pageUrl('회계')]: fakePage(
        [{ id: '3', createdAt: hoursAgo(1), title: '회계' }, { id: '4', createdAt: hoursAgo(30), title: '회계' }],
        1,
      ),
    })
    const summary = await runCollection(adapter, criteria({ keywords: ['전산', '회계'], initialDays: 3 }), store, s.deps(NOW))
    expect(summary.stopReasons).toEqual({ 전산: 'cutoff', 회계: 'exhausted' })
    expect((await store.listPostings('jobkorea')).map((p) => p.externalId).sort()).toEqual(['1', '3', '4'])
  })

  it('marks open postings past their deadline as expired and leaves the rest', async () => {
    const store = await freshStore()
    const past = '2026-11-10T00:00:00+09:00'
    await store.putPosting(stored('1', { deadline: past }))
    await store.putPosting(stored('2', { deadline: past, status: 'saved' }))
    await store.putPosting(stored('3', { deadline: past, status: 'applied' }))
    await store.putPosting(stored('4', { deadline: past, status: 'dismissed' }))
    await store.putPosting(stored('5', { deadline: null }))
    const s = site({ [pageUrl('전산')]: fakePage([], 1) })

    const summary = await runCollection(adapter, criteria(), store, s.deps(NOW))

    expect(summary.expiredMarked).toBe(2)
    const statuses = Object.fromEntries((await store.listPostings('jobkorea')).map((p) => [p.externalId, p.status]))
    expect(statuses).toEqual({ 1: 'expired', 2: 'expired', 3: 'applied', 4: 'dismissed', 5: 'new' })
  })

  it('prunes discards past their deadline and deadline-less ones older than 60 days', async () => {
    const store = await freshStore()
    const record = (id: string, deadline: string | null, discardedAt: string): DiscardRecord => ({
      site: 'jobkorea',
      externalId: id,
      reason: { gate: 'location' },
      discardedAt,
      deadline,
    })
    await store.putDiscard(record('past', '2026-11-10T00:00:00+09:00', '2026-11-01T00:00:00Z'))
    await store.putDiscard(record('future', '2026-12-01T00:00:00+09:00', '2026-06-01T00:00:00Z'))
    await store.putDiscard(record('old', null, '2026-09-01T00:00:00Z'))
    await store.putDiscard(record('recent', null, '2026-11-01T00:00:00Z'))
    const s = site({ [pageUrl('전산')]: fakePage([], 1) })

    await runCollection(adapter, criteria(), store, s.deps(NOW))

    expect((await store.listDiscards('jobkorea')).map((d) => d.externalId).sort()).toEqual(['future', 'recent'])
  })
})
