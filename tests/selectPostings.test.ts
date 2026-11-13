import { describe, expect, it } from 'vitest'
import { INITIAL_VIEW, PAGE_SIZE, selectPostings, type ListView } from '../src/page/selectPostings'
import type { Career, PostingStatus, StoredPosting } from '../src/shared/types'
import { posting } from './helpers'

function stored(id: string, o: Partial<StoredPosting> = {}): StoredPosting {
  return {
    ...posting({ externalId: id, postedAt: '2026-11-13T10:00:00+09:00' }),
    status: 'new',
    memo: '',
    matchedKeywords: ['전산'],
    score: null,
    scoreReason: null,
    collectedAt: '2026-11-13T00:00:00Z',
    updatedAt: '2026-11-13T00:00:00Z',
    ...o,
  }
}

const view = (o: Partial<ListView> = {}): ListView => ({ ...INITIAL_VIEW, ...o })
const ids = (rows: StoredPosting[]) => rows.map((p) => p.externalId)
const withCareer = (id: string, career: Career) => stored(id, { career })

describe('selectPostings status tabs and counts', () => {
  const all: PostingStatus[] = ['new', 'new', 'saved', 'applied', 'dismissed', 'expired']
  const data = all.map((status, i) => stored(String(i), { status }))

  it('lists only the chosen tab', () => {
    expect(ids(selectPostings(data, view({ status: 'new' })).rows).sort()).toEqual(['0', '1'])
    expect(ids(selectPostings(data, view({ status: 'saved' })).rows)).toEqual(['2'])
    expect(ids(selectPostings(data, view({ status: 'expired' })).rows)).toEqual(['5'])
    expect(selectPostings(data, view({ status: 'all' })).rows).toHaveLength(6)
  })

  it('counts every tab whatever tab is open', () => {
    expect(selectPostings(data, view({ status: 'saved' })).counts).toEqual({ new: 2, saved: 1, applied: 1, dismissed: 1, expired: 1, all: 6 })
  })

  it('counts follow the other filters', () => {
    const mixed = [stored('a', { title: '전산 운영' }), stored('b', { title: '회계', status: 'saved' })]
    expect(selectPostings(mixed, view({ query: '전산' })).counts).toMatchObject({ new: 1, saved: 0, all: 1 })
  })
})

describe('selectPostings filters', () => {
  const data = [
    withCareer('new', { kind: 'new' }),
    withCareer('both', { kind: 'newOrExperienced', minYears: null }),
    withCareer('any', { kind: 'any' }),
    withCareer('exp', { kind: 'experienced', minYears: 3 }),
    withCareer('unk', { kind: 'unknown' }),
  ]
  const pick = (career: ListView['career']) => ids(selectPostings(data, view({ career })).rows).sort()

  it('maps each career option to its kinds', () => {
    expect(pick('all')).toEqual(['any', 'both', 'exp', 'new', 'unk'])
    expect(pick('newOk')).toEqual(['any', 'both', 'new'])
    expect(pick('experienced')).toEqual(['both', 'exp'])
    expect(pick('any')).toEqual(['any'])
  })

  it('filters by site', () => {
    const sites = [stored('1'), stored('2', { site: 'saramin' })]
    expect(ids(selectPostings(sites, view({ site: 'saramin' })).rows)).toEqual(['2'])
  })

  it('searches title and company, ignoring case and surrounding space', () => {
    const data2 = [stored('1', { title: 'Java 개발', company: '가나다' }), stored('2', { title: '회계', company: 'JAVA 컴퍼니' }), stored('3', { title: '영업' })]
    expect(ids(selectPostings(data2, view({ query: ' java ' })).rows).sort()).toEqual(['1', '2'])
    expect(ids(selectPostings(data2, view({ query: '가나' })).rows)).toEqual(['1'])
  })
})

describe('selectPostings order', () => {
  it('puts higher scores first, unscored last, newest first within equal scores', () => {
    const data = [
      stored('old-null', { postedAt: '2026-11-01T00:00:00Z' }),
      stored('low', { score: 40, postedAt: '2026-11-12T00:00:00Z' }),
      stored('new-null', { postedAt: '2026-11-12T00:00:00Z' }),
      stored('high', { score: 90, postedAt: '2026-11-01T00:00:00Z' }),
      stored('zero', { score: 0 }),
      stored('low-newer', { score: 40, postedAt: '2026-11-13T00:00:00Z' }),
    ]
    expect(ids(selectPostings(data, view()).rows)).toEqual(['high', 'low-newer', 'low', 'zero', 'new-null', 'old-null'])
  })
})

describe('selectPostings paging', () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => stored(String(i), { postedAt: new Date(Date.UTC(2026, 10, 1, 0, i)).toISOString() }))

  it('cuts pages at the page size boundary', () => {
    expect(selectPostings(many(PAGE_SIZE), view()).totalPages).toBe(1)
    const eleven = selectPostings(many(PAGE_SIZE + 1), view({ page: 2 }))
    expect(eleven.totalPages).toBe(2)
    expect(ids(eleven.rows)).toEqual(['0'])
  })

  it('returns one empty page for no postings', () => {
    expect(selectPostings([], view())).toMatchObject({ rows: [], page: 1, totalPages: 1 })
  })

  it('clamps a page that no longer exists after the result shrinks', () => {
    const result = selectPostings(many(12), view({ page: 3 }))
    expect(result.page).toBe(2)
    expect(result.rows).toHaveLength(2)
    expect(selectPostings(many(12), view({ page: 0 })).page).toBe(1)
  })
})
