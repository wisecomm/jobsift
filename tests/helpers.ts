import { readFileSync } from 'node:fs'
import jobkoreaJson from '../adapters/jobkorea.json'
import { parseAdapter } from '../src/adapter/schema'
import type { SearchCriteria } from '../src/shared/types'

export const adapter = parseAdapter(jobkoreaJson)

export const fixtureHtml = readFileSync(new URL('./fixtures/jobkorea-search-p1.html', import.meta.url), 'utf8')

export function criteria(overrides: Partial<SearchCriteria> = {}): SearchCriteria {
  return {
    keywords: ['전산'],
    excludeKeywords: [],
    locations: [],
    career: 'any',
    initialDays: 7,
    description: '',
    ...overrides,
  }
}

export interface FakeItem {
  id: string
  createdAt: string
}

/** Builds a page whose flight payload carries a JOB_LIST (and a CODES) query, like the real site. */
export function fakePage(items: FakeItem[], totalPages: number): string {
  const content = items.map((item) => ({
    id: item.id,
    title: `공고 ${item.id}`,
    companyName: `회사 ${item.id}`,
    createdAt: item.createdAt,
    applicationPeriod: { start: item.createdAt, end: '2099-01-01T23:00:00+09:00' },
    careerType: '4',
    careerRange: 0,
    areaCodeList: ['I010'],
    jobClassificationOrIndustry: ',IT,',
  }))
  const entry = (queryKey: string, data: unknown) => ({ dehydratedAt: 1, state: { data }, queryKey: [queryKey] })
  const payload =
    JSON.stringify(entry('CODES', { area: [{ code: 'I010', tagDisplayName: '서울>강남구' }] })) +
    JSON.stringify(entry('JOB_LIST', { pageNumber: 0, totalPages, totalElements: 0, content }))
  return `<html><script>self.__next_f.push([1,${JSON.stringify(payload)}])</script></html>`
}
