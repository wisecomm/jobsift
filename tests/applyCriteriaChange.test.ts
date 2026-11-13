import { describe, expect, it } from 'vitest'
import { applyCriteriaChange } from '../src/engine/applyCriteriaChange'
import { criteriaChanged } from '../src/engine/criteria'
import type { StoredPosting } from '../src/shared/types'
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

    const { removed } = await applyCriteriaChange(store, 'jobkorea', criteria({ locations: ['서울'] }), NOW)

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
    await applyCriteriaChange(store, 'jobkorea', criteria({ keywords: ['회계'] }), NOW)
    expect((await store.getPosting({ site: 'jobkorea', externalId: '1' }))?.matchedKeywords).toEqual(['회계'])
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
