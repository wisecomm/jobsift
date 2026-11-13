import type { SiteAdapter } from '../adapter/schema'
import type { SearchCriteria } from '../shared/types'

export function buildSearchUrl(
  adapter: SiteAdapter,
  criteria: SearchCriteria,
  keyword: string,
  page: number,
): string {
  let url = adapter.search.urlTemplate
    .replace('{keyword}', encodeURIComponent(keyword))
    .replace('{page}', String(page))
  for (const param of adapter.search.params) {
    const value = param.values[criteria[param.criterion]]
    if (value !== null) url += `${url.includes('?') ? '&' : '?'}${param.query}=${value}`
  }
  return url
}
