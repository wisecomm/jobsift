import { readFileSync } from 'node:fs'
import { IDBFactory } from 'fake-indexeddb'
import { getAdapter } from '../src/adapter/registry'
import { openStore } from '../src/storage/store'
import type { JobPosting, SearchCriteria } from '../src/shared/types'

export const adapter = getAdapter('jobkorea')!

export const fixtureHtml = readFileSync(new URL('./fixtures/jobkorea-search-p1.html', import.meta.url), 'utf8')

export function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    keywords: ['전산'],
    locations: [],
    career: 'any',
    description: '',
    ...overrides,
  }
}

export interface FakeItem {
  id: string
  createdAt: string
  title?: string
  company?: string
  tags?: string
  areas?: string[]
  careerType?: string
  deadline?: string
}

const AREA_LABELS: Record<string, string> = { I010: '서울>강남구', B010: '경기>성남시 분당구' }

export function posting(overrides: Partial<JobPosting> = {}): JobPosting {
  return {
    site: 'jobkorea',
    externalId: '1',
    title: '전산 담당자',
    company: '회사',
    locations: ['서울>강남구'],
    career: { kind: 'any' },
    jobTags: ['IT'],
    postedAt: '2026-11-13T10:00:00+09:00',
    deadline: null,
    url: 'https://www.jobkorea.co.kr/Recruit/GI_Read/1',
    ...overrides,
  }
}

/** Builds a page whose flight payload carries a JOB_LIST (and a CODES) query, like the real site. */
export function fakePage(items: FakeItem[], totalPages: number): string {
  const content = items.map((item) => ({
    id: item.id,
    title: item.title ?? `전산 공고 ${item.id}`,
    companyName: item.company ?? `회사 ${item.id}`,
    createdAt: item.createdAt,
    applicationPeriod: { start: item.createdAt, end: item.deadline ?? '2099-01-01T23:00:00+09:00' },
    careerType: item.careerType ?? '4',
    careerRange: 0,
    areaCodeList: item.areas ?? ['I010'],
    jobClassificationOrIndustry: item.tags ?? ',IT,',
  }))
  const entry = (queryKey: string, data: unknown) => ({ dehydratedAt: 1, state: { data }, queryKey: [queryKey] })
  const payload =
    JSON.stringify(entry('CODES', { area: Object.entries(AREA_LABELS).map(([code, tagDisplayName]) => ({ code, tagDisplayName })) })) +
    JSON.stringify(entry('JOB_LIST', { pageNumber: 0, totalPages, totalElements: 0, content }))
  return `<html><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></html>`
}

/** A store on its own empty fake database, so tests never share state. */
export async function freshStore() {
  Object.assign(globalThis, { indexedDB: new IDBFactory() })
  return openStore()
}
