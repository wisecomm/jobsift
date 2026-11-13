import { adapters } from '../adapter/registry'

export const SITES_TAB_LABEL = '사이트 설정'

export type SiteInfo =
  | { availability: 'available'; id: string; name: string; homeUrl: string; requiresLogin: boolean }
  | { availability: 'planned'; id: string; name: string; homeUrl: string }

// Planned sites have no adapter yet, so they are display data only and never reach the worker.
const PLANNED: SiteInfo[] = [
  { availability: 'planned', id: 'saramin', name: '사람인', homeUrl: 'https://www.saramin.co.kr' },
  { availability: 'planned', id: 'gojobs', name: '나라일터', homeUrl: 'https://www.gojobs.go.kr' },
]

export const SITE_LIST: SiteInfo[] = [
  ...adapters.map(({ id, name, homeUrl, requiresLogin }): SiteInfo => ({ availability: 'available', id, name, homeUrl, requiresLogin })),
  ...PLANNED,
]

export const siteName = (id: string): string => SITE_LIST.find((site) => site.id === id)?.name ?? id
