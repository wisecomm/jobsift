import { openDB } from 'idb'
import { IDBFactory } from 'fake-indexeddb'
import { describe, expect, it } from 'vitest'
import { openStore } from '../src/storage/store'
import type { DiscardRecord, PendingPosting, StoredPosting } from '../src/shared/types'
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

const pending = (id: string): PendingPosting => ({ ...posting({ externalId: id }), matchedKeywords: ['전산'], queuedAt: '2026-11-13T00:00:00Z' })

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

  it('counts pending ids as known and keeps pending per site', async () => {
    const store = await freshStore()
    await store.putPending(pending('7'))
    await store.putPending({ ...pending('8'), site: 'saramin' })
    expect(await store.knownIds('jobkorea')).toEqual(new Set(['7']))
    expect((await store.listPending('jobkorea')).map((p) => p.externalId)).toEqual(['7'])
  })

  it('commitScored moves pending to postings and discards together', async () => {
    const store = await freshStore()
    await store.putPending(pending('1'))
    await store.putPending(pending('2'))
    await store.putPending(pending('3'))
    await store.commitScored({
      kept: [{ ...stored('1'), score: 80, scoreReason: '맞음' }],
      dropped: [{ ...discard('2'), reason: { gate: 'lowScore', score: 20 }, title: '새면 안 됨' } as DiscardRecord],
      resolved: [{ site: 'jobkorea', externalId: '1' }, { site: 'jobkorea', externalId: '2' }],
    })
    expect((await store.listPending('jobkorea')).map((p) => p.externalId)).toEqual(['3'])
    expect(await store.getPosting({ site: 'jobkorea', externalId: '1' })).toMatchObject({ score: 80 })
    const [record] = await store.listDiscards('jobkorea')
    expect(Object.keys(record ?? {}).sort()).toEqual(['deadline', 'discardedAt', 'externalId', 'reason', 'site'])
    expect(record?.reason).toEqual({ gate: 'lowScore', score: 20 })
  })

  it('clearAll wipes every store', async () => {
    const store = await freshStore()
    await store.putPending(pending('4'))
    await store.putPosting(stored('1'))
    await store.putDiscard(discard('2'))
    await store.putCollectState({ site: 'jobkorea', keyword: '전산', lastCollectedAt: 'x' })
    await store.clearAll()
    expect(await store.knownIds('jobkorea')).toEqual(new Set())
    expect(await store.listPending('jobkorea')).toEqual([])
    expect(await store.getCollectState('jobkorea', '전산')).toBeUndefined()
  })
})

describe('upgrade from version 1', () => {
  it('keeps postings, discards and collect state and adds the pending store', async () => {
    Object.assign(globalThis, { indexedDB: new IDBFactory() })
    const v1 = await openDB('kr-job-finder', 1, {
      upgrade(db) {
        db.createObjectStore('postings', { keyPath: ['site', 'externalId'] })
        db.createObjectStore('discards', { keyPath: ['site', 'externalId'] })
        db.createObjectStore('collectState', { keyPath: ['site', 'keyword'] })
      },
    })
    await v1.put('postings', { ...stored('1'), memo: '그대로' })
    await v1.put('discards', discard('2'))
    await v1.put('collectState', { site: 'jobkorea', keyword: '전산', lastCollectedAt: 'x' })
    v1.close()

    const store = await openStore()

    expect(await store.getPosting({ site: 'jobkorea', externalId: '1' })).toMatchObject({ memo: '그대로' })
    expect((await store.listDiscards('jobkorea')).map((d) => d.externalId)).toEqual(['2'])
    expect(await store.getCollectState('jobkorea', '전산')).toBeDefined()
    await store.putPending(pending('3'))
    expect((await store.listPending('jobkorea')).map((p) => p.externalId)).toEqual(['3'])
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
