import { describe, expect, it } from 'vitest'
import type { DiscardRecord, StoredPosting } from '../src/shared/types'
import { freshStore, posting } from './helpers'

const stored = (id: string, site = 'jobkorea'): StoredPosting => ({
  ...posting({ site, externalId: id }),
  status: 'new',
  memo: '',
  matchedKeywords: ['전산'],
  score: null,
  scoreReason: null,
  collectedAt: '2026-11-13T00:00:00Z',
  updatedAt: '2026-11-13T00:00:00Z',
})

const discard = (id: string, site = 'jobkorea'): DiscardRecord => ({
  site,
  externalId: id,
  reason: { gate: 'location' },
  discardedAt: '2026-11-13T00:00:00Z',
  deadline: null,
})

describe('store', () => {
  it('round-trips a posting by site and id', async () => {
    const store = await freshStore()
    await store.putPosting(stored('1'))
    expect(await store.getPosting({ site: 'jobkorea', externalId: '1' })).toEqual(stored('1'))
    expect(await store.getPosting({ site: 'saramin', externalId: '1' })).toBeUndefined()
  })

  it('lists postings of one site only', async () => {
    const store = await freshStore()
    await store.putPosting(stored('1'))
    await store.putPosting(stored('2', 'saramin'))
    expect((await store.listPostings('jobkorea')).map((p) => p.externalId)).toEqual(['1'])
  })

  it('addPosting leaves an existing posting untouched', async () => {
    const store = await freshStore()
    await store.putPosting({ ...stored('1'), status: 'saved', memo: '면접 준비' })
    expect(await store.addPosting(stored('1'))).toBe(false)
    expect(await store.getPosting({ site: 'jobkorea', externalId: '1' })).toMatchObject({ status: 'saved', memo: '면접 준비' })
  })

  it('keeps nothing but identity, reason, time and deadline for a discard', async () => {
    const store = await freshStore()
    await store.putDiscard({ ...discard('9'), title: '비밀', company: '회사', url: 'x' } as DiscardRecord)
    const [record] = await store.listDiscards('jobkorea')
    expect(Object.keys(record ?? {}).sort()).toEqual(['deadline', 'discardedAt', 'externalId', 'reason', 'site'])
  })

  it('knows the union of posting and discard ids for a site', async () => {
    const store = await freshStore()
    await store.putPosting(stored('1'))
    await store.putDiscard(discard('2'))
    await store.putDiscard(discard('3', 'saramin'))
    expect(await store.knownIds('jobkorea')).toEqual(new Set(['1', '2']))
  })

  it('clearAll wipes every store', async () => {
    const store = await freshStore()
    await store.putPosting(stored('1'))
    await store.putDiscard(discard('2'))
    await store.putCollectState({ site: 'jobkorea', keyword: '전산', lastCollectedAt: 'x' })
    await store.clearAll()
    expect(await store.knownIds('jobkorea')).toEqual(new Set())
    expect(await store.getCollectState('jobkorea', '전산')).toBeUndefined()
  })
})

describe('updatePosting', () => {
  const key = { site: 'jobkorea', externalId: '1' }
  const now = new Date('2026-11-14T00:00:00Z')

  it('changes the status and stamps updatedAt', async () => {
    const store = await freshStore()
    await store.putPosting(stored('1'))
    const result = await store.updatePosting(key, { status: 'saved' }, now)
    expect(result).toMatchObject({ kind: 'updated', posting: { status: 'saved', updatedAt: now.toISOString() } })
    expect(await store.getPosting(key)).toMatchObject({ status: 'saved', memo: '' })
  })

  it('changes the memo without touching the status', async () => {
    const store = await freshStore()
    await store.putPosting({ ...stored('1'), status: 'applied' })
    await store.updatePosting(key, { memo: '서류 마감 전에 제출' }, now)
    expect(await store.getPosting(key)).toMatchObject({ status: 'applied', memo: '서류 마감 전에 제출' })
  })

  it('refuses a status change on an expired posting and leaves it as it was', async () => {
    const store = await freshStore()
    await store.putPosting({ ...stored('1'), status: 'expired' })
    expect(await store.updatePosting(key, { status: 'saved', memo: '새 메모' }, now)).toEqual({ kind: 'expired' })
    expect(await store.getPosting(key)).toMatchObject({ status: 'expired', memo: '' })
  })

  it('still lets an expired posting take a memo', async () => {
    const store = await freshStore()
    await store.putPosting({ ...stored('1'), status: 'expired' })
    expect((await store.updatePosting(key, { memo: '참고용' }, now)).kind).toBe('updated')
    expect(await store.getPosting(key)).toMatchObject({ status: 'expired', memo: '참고용' })
  })

  it('reports an unknown key and writes nothing', async () => {
    const store = await freshStore()
    expect(await store.updatePosting(key, { status: 'saved' }, now)).toEqual({ kind: 'not-found' })
    expect(await store.listPostings('jobkorea')).toEqual([])
  })
})
