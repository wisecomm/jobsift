import { adapters } from '../adapter/registry'
import { defaultSiteMaxItems } from '../engine/siteSettings'

export const SITES_TAB_LABEL = '사이트 설정'

export type SiteInfo =
  | { availability: 'available'; id: string; name: string; homeUrl: string; requiresLogin: boolean; defaultMaxItems: number }
  | { availability: 'planned'; id: string; name: string; homeUrl: string }

// Planned sites have no adapter yet, so they are display data only and never reach the worker.
const PLANNED: SiteInfo[] = []

export const SITE_LIST: SiteInfo[] = [
  ...adapters.map(
    (adapter): SiteInfo => ({
      availability: 'available',
      id: adapter.id,
      name: adapter.name,
      homeUrl: adapter.homeUrl,
      requiresLogin: adapter.requiresLogin,
      defaultMaxItems: defaultSiteMaxItems(adapter),
    }),
  ),
  ...PLANNED,
]

export function orderedSiteList(siteOrder: readonly string[]): SiteInfo[] {
  const byId = new Map<string, SiteInfo>(SITE_LIST.filter((s) => s.availability === 'available').map((s) => [s.id, s]))
  const ordered = siteOrder.map((id) => byId.get(id)).filter((s): s is SiteInfo => s !== undefined)
  const seen = new Set(ordered.map((s) => s.id))
  for (const site of SITE_LIST) {
    if (!seen.has(site.id)) ordered.push(site)
  }
  return ordered
}

export const siteName = (id: string): string => SITE_LIST.find((site) => site.id === id)?.name ?? id
