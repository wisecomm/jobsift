import { describe, expect, it } from 'vitest'
import { applyCriteriaChange } from '../src/engine/applyCriteriaChange'
import { criteriaChanged } from '../src/engine/criteria'
import type { PendingPosting, StoredPosting } from '../src/shared/types'
import { criteria, freshStore, posting } from './helpers'

const NOW = new Date('2026-11-13T20:00:00+09:00')

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

describe('applyCriteriaChange', () => {
  it('clears discards and collect state, drops new postings that now fail, keeps the rest', async () => {
    const store = await freshStore()
    const busan = { locations: ['부산>해운대구'] }
    await store.putPosting(stored('keep'))
    await store.putPosting(stored('drop', busan))
    await store.putPosting(stored('saved', { ...busan, status: 'saved', memo: '메모' }))
    await store.putPosting(stored('applied', { ...busan, status: 'applied' }))
    await store.putDiscard({ site: 'jobkorea', externalId: 'old', reason: { gate: 'career' }, discardedAt: 'x', deadline: null })
    await store.putCollectState({ site: 'jobkorea', keyword: '전산', lastCollectedAt: 'x' })

    const { removed } = await applyCriteriaChange(store, criteria({ locations: ['서울'] }), { aiOn: false }, NOW)

    expect(removed).toBe(1)
    const rest = await store.listPostings('jobkorea')
    expect(rest.map((p) => p.externalId).sort()).toEqual(['applied', 'keep', 'saved'])
    expect(rest.find((p) => p.externalId === 'saved')).toMatchObject({ status: 'saved', memo: '메모' })
    expect((await store.listDiscards('jobkorea')).map((d) => [d.externalId, d.reason])).toEqual([['drop', { gate: 'location' }]])
    expect(await store.getCollectState('jobkorea', '전산')).toBeUndefined()
  })

  it('refreshes matched keywords of kept new postings', async () => {
    const store = await freshStore()
    await store.putPosting(stored('1', { title: '전산 회계', matchedKeywords: ['전산'] }))
    await applyCriteriaChange(store, criteria({ keywords: ['회계'] }), { aiOn: false }, NOW)
    expect((await store.getPosting({ site: 'jobkorea', externalId: '1' }))?.matchedKeywords).toEqual(['회계'])
  })
})

const queuedPosting = (id: string, overrides: Partial<PendingPosting> = {}): PendingPosting => ({
  ...posting({ externalId: id }),
  matchedKeywords: ['전산'],
  queuedAt: '2026-11-02T00:00:00Z',
  ...overrides,
})

describe('applyCriteriaChange with AI on', () => {
  it('moves untouched new postings to pending with their score dropped, and leaves acted-on and expired ones alone', async () => {
    const store = await freshStore()
    await store.putPosting(stored('new', { score: 80, scoreReason: '이유' }))
    await store.putPosting(stored('memo', { memo: '적어 둠', score: 70, scoreReason: '이유' }))
    for (const status of ['saved', 'applied', 'dismissed', 'expired'] as const) await store.putPosting(stored(status, { status, score: 90, scoreReason: '이유' }))
    await store.putDiscard({ site: 'jobkorea', externalId: 'low', reason: { gate: 'lowScore', score: 3 }, discardedAt: 'x', deadline: null })
    await store.putCollectState({ site: 'jobkorea', keyword: '전산', lastCollectedAt: 'x' })

    const result = await applyCriteriaChange(store, criteria(), { aiOn: true }, NOW)

    expect(result).toEqual({ removed: 0, queued: 1 })
    expect((await store.listPending('jobkorea')).map((p) => [p.externalId, p.queuedAt, p.matchedKeywords])).toEqual([['new', '2026-11-01T00:00:00Z', ['전산']]])
    const rest = Object.fromEntries((await store.listPostings('jobkorea')).map((p) => [p.externalId, [p.status, p.score]]))
    expect(rest).toEqual({ memo: ['new', 70], saved: ['saved', 90], applied: ['applied', 90], dismissed: ['dismissed', 90], expired: ['expired', 90] })
    expect(await store.listDiscards('jobkorea')).toEqual([])
    expect(await store.getCollectState('jobkorea', '전산')).toBeUndefined()
  })

  it('does not apply the keyword gate, but does apply the other rules, to postings and to pending', async () => {
    const store = await freshStore()
    await store.putPosting(stored('off-topic', { title: '보험 설계사', jobTags: [] }))
    await store.putPosting(stored('busan', { locations: ['부산>해운대구'] }))
    await store.putPending(queuedPosting('p-ok', { title: '세무 상담' }))
    await store.putPending(queuedPosting('p-busan', { locations: ['부산>해운대구'] }))

    const result = await applyCriteriaChange(store, criteria({ locations: ['서울'] }), { aiOn: true }, NOW)

    expect(result).toEqual({ removed: 2, queued: 2 })
    expect((await store.listPending('jobkorea')).map((p) => p.externalId).sort()).toEqual(['off-topic', 'p-ok'])
    expect((await store.listDiscards('jobkorea')).map((d) => [d.externalId, d.reason.gate]).sort()).toEqual([['busan', 'location'], ['p-busan', 'location']])
  })
})

describe('applyCriteriaChange with AI turned off', () => {
  it('re-evaluates new postings with the keyword gate and clears their score', async () => {
    const store = await freshStore()
    await store.putPosting(stored('keep', { score: 80, scoreReason: '이유' }))
    await store.putPosting(stored('drop', { title: '보험 설계사', jobTags: [], score: 85, scoreReason: '이유' }))
    await store.putPosting(stored('saved', { status: 'saved', title: '보험 설계사', jobTags: [], score: 85, scoreReason: '이유' }))

    await applyCriteriaChange(store, criteria(), { aiOn: false }, NOW)

    const rest = await store.listPostings('jobkorea')
    expect(rest.map((p) => [p.externalId, p.score, p.scoreReason]).sort()).toEqual([['keep', null, null], ['saved', 85, '이유']])
    expect((await store.listDiscards('jobkorea')).map((d) => [d.externalId, d.reason.gate])).toEqual([['drop', 'keywordMismatch']])
  })

  it('does not strand pending postings: passes become new postings, the rest are discarded', async () => {
    const store = await freshStore()
    await store.putPending(queuedPosting('match'))
    await store.putPending(queuedPosting('mismatch', { title: '보험 설계사', jobTags: [] }))

    const result = await applyCriteriaChange(store, criteria(), { aiOn: false }, NOW)

    expect(result.removed).toBe(1)
    expect(await store.listPending('jobkorea')).toEqual([])
    expect(await store.getPosting({ site: 'jobkorea', externalId: 'match' })).toMatchObject({ status: 'new', memo: '', score: null, scoreReason: null, matchedKeywords: ['전산'], collectedAt: '2026-11-02T00:00:00Z' })
    expect((await store.listDiscards('jobkorea')).map((d) => [d.externalId, d.reason.gate])).toEqual([['mismatch', 'keywordMismatch']])
  })
})

describe('criteriaChanged', () => {
  it('ignores description, spacing, duplicates and order', () => {
    const base = criteria({ keywords: ['전산', '회계'], locations: ['서울'] })
    const same = criteria({ keywords: [' 회계', '전산', '전산'], locations: ['서울 '], description: '다른 설명' })
    expect(criteriaChanged(base, same)).toBe(false)
  })

  it('notices a real difference in any rule field', () => {
    const base = criteria()
    expect(criteriaChanged(base, criteria({ keywords: ['회계'] }))).toBe(true)
    expect(criteriaChanged(base, criteria({ excludeKeywords: ['영업'] }))).toBe(true)
    expect(criteriaChanged(base, criteria({ locations: ['서울'] }))).toBe(true)
    expect(criteriaChanged(base, criteria({ career: 'new' }))).toBe(true)
    expect(criteriaChanged(base, criteria({ initialDays: 3 }))).toBe(true)
  })
})
