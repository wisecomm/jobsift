import { describe, expect, it } from 'vitest'
import { runCollection } from '../src/engine/runCollection'
import type { ScoreFn, ScoreItem } from '../src/ai/types'
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

describe('runCollection with AI on', () => {
  const posts = (ids: number[]): FakeItem[] =>
    ids.map((n) => ({ id: String(n), createdAt: hoursAgo(n), title: n % 2 === 0 ? `공고 ${n}` : `전산 공고 ${n}` }))

  /** Score = the number in the title, so ids pick the outcome. */
  function ai(log: string[], failOnCall = 0, minScore = 5) {
    let calls = 0
    const score: ScoreFn = async (items: ScoreItem[]) => {
      calls++
      log.push(`score#${calls}(${items.length})`)
      if (calls === failOnCall) return { kind: 'error', error: { kind: 'rateLimited' } }
      return { kind: 'ok', scores: items.map((i) => ({ index: i.index, score: Number(/\d+/.exec(i.title)?.[0]), reason: '이유' })) }
    }
    return { score, minScore, now: NOW, pace: async () => void log.push('pace') }
  }

  it('turns the keyword gate off, queues passes, and scores them after fetching', async () => {
    const store = await freshStore()
    const log: string[] = []
    const s = site({ [pageUrl('전산')]: fakePage(posts([1, 2, 3, 4, 5, 6, 7, 8]), 1) })

    const summary = await runCollection(adapter, criteria({ locations: ['서울'] }), store, { ...s.deps(NOW), scoring: ai(log) })

    expect(summary).toMatchObject({
      scanned: 8,
      saved: 0,
      queued: 8,
      discarded: 0,
      scoring: { scored: 8, kept: 4, lowScore: 4, pendingLeft: 0, error: null },
    })
    expect((await store.listPostings('jobkorea')).map((p) => p.score).sort()).toEqual([5, 6, 7, 8])
    expect((await store.listDiscards('jobkorea')).filter((d) => d.reason.gate === 'lowScore')).toHaveLength(4)
    expect(log).toEqual(['pace', 'score#1(8)'])
  })

  it('still applies the non-keyword rules before queueing', async () => {
    const store = await freshStore()
    const s = site({ [pageUrl('전산')]: fakePage(mixedItems, 1) })
    const summary = await runCollection(adapter, rules, store, { ...s.deps(NOW), scoring: ai([], 0, 0) })
    expect(summary.discardedByGate).toMatchObject({ keywordMismatch: 0, excludeKeyword: 1, location: 1, career: 1, expired: 1 })
    expect(summary.queued).toBe(2)
  })

  it('drains pending before fetching and treats pending ids as known', async () => {
    const store = await freshStore()
    await store.putPending({ ...posting({ externalId: '9', title: '공고 9' }), matchedKeywords: [], queuedAt: '2026-11-13T00:00:00Z' })
    const log: string[] = []
    const fetching: string[] = []
    const s = site({ [pageUrl('전산')]: fakePage(posts([9, 10]), 1) })
    const deps = s.deps(NOW)
    const summary = await runCollection(adapter, criteria(), store, {
      ...deps,
      fetchHtml: async (url) => {
        log.push('fetch')
        fetching.push(url)
        return deps.fetchHtml(url)
      },
      scoring: ai(log, 0, 0),
    })

    expect(log).toEqual(['pace', 'score#1(1)', 'fetch', 'pace', 'score#2(1)'])
    expect(summary.scanned).toBe(1)
    expect(summary.scoring).toMatchObject({ scored: 2, kept: 2 })
    expect((await store.listPostings('jobkorea')).map((p) => p.externalId).sort()).toEqual(['10', '9'])
  })

  it('on a failed pass, still collects, queues the new postings, and reports the Korean error', async () => {
    const store = await freshStore()
    await store.putPending({ ...posting({ externalId: '9', title: '공고 9' }), matchedKeywords: [], queuedAt: '2026-11-13T00:00:00Z' })
    const log: string[] = []
    const s = site({ [pageUrl('전산')]: fakePage(posts([10, 12]), 1) })

    const summary = await runCollection(adapter, criteria(), store, { ...s.deps(NOW), scoring: ai(log, 1) })

    expect(log).toEqual(['pace', 'score#1(1)'])
    expect(summary.queued).toBe(2)
    expect(summary.scoring).toMatchObject({ scored: 0, pendingLeft: 3 })
    expect(summary.scoring?.error).toMatch(/한도/)
    expect(await store.listPostings('jobkorea')).toEqual([])
  })

  it('does not fetch or evaluate a queued posting twice', async () => {
    const store = await freshStore()
    const s = site({ [pageUrl('전산')]: fakePage(posts([10]), 1) })
    await runCollection(adapter, criteria(), store, { ...s.deps(NOW), scoring: ai([], 1) })
    const again = await runCollection(adapter, criteria(), store, { ...s.deps(new Date(NOW.getTime() + 60_000)), scoring: ai([], 1) })
    expect(again.scanned).toBe(0)
    expect(again.scoring?.pendingLeft).toBe(1)
  })

  it('rules-only mode reports no scoring and queues nothing', async () => {
    const store = await freshStore()
    const s = site({ [pageUrl('전산')]: fakePage(mixedItems, 1) })
    const summary = await runCollection(adapter, rules, store, s.deps(NOW))
    expect(summary).toMatchObject({ scoring: null, queued: 0, saved: 1 })
    expect(await store.listPending('jobkorea')).toEqual([])
  })
})
