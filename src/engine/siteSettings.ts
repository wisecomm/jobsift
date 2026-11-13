import { z } from 'zod'
import type { SiteAdapter } from '../adapter/schema'
import type { StorageArea } from '../ai/settings'
import type { SiteSettings } from '../shared/types'

const SETTINGS_KEY = 'siteSettings'

const rawSchema = z.object({
  enabledSites: z.array(z.string()),
  siteOrder: z.array(z.string()).optional(),
})

function normalizeOrder(rawOrder: readonly string[], availableIds: readonly string[]): string[] {
  const known = new Set(availableIds)
  const seen = new Set<string>()
  const ordered: string[] = []
  for (const id of rawOrder) {
    if (known.has(id) && !seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }
  for (const id of availableIds) {
    if (!seen.has(id)) {
      seen.add(id)
      ordered.push(id)
    }
  }
  return ordered
}

export const defaultSiteSettings = (availableIds: readonly string[]): SiteSettings => ({
  enabledSites: [...availableIds],
  siteOrder: [...availableIds],
})

/** Ids that no adapter owns are dropped, and an empty result falls back to every site, so collection never has nothing to run. */
export function parseSiteSettings(raw: unknown, availableIds: readonly string[]): SiteSettings {
  const parsed = rawSchema.safeParse(raw)
  if (!parsed.success) return defaultSiteSettings(availableIds)
  const siteOrder = normalizeOrder(parsed.data.siteOrder ?? [], availableIds)
  const enabledSet = new Set(parsed.data.enabledSites)
  const enabledSites = siteOrder.filter((id) => enabledSet.has(id))
  return enabledSites.length > 0 ? { enabledSites, siteOrder } : { enabledSites: [...siteOrder], siteOrder }
}

export async function loadSiteSettings(area: StorageArea, availableIds: readonly string[]): Promise<SiteSettings> {
  return parseSiteSettings((await area.get(SETTINGS_KEY))[SETTINGS_KEY], availableIds)
}

export async function storeSiteSettings(area: StorageArea, settings: SiteSettings): Promise<void> {
  await area.set({ [SETTINGS_KEY]: settings })
}

export type ToggleResult = { kind: 'changed'; settings: SiteSettings } | { kind: 'last-site' }

export function toggleSite(settings: SiteSettings, id: string, on: boolean): ToggleResult {
  const enabledSet = new Set(settings.enabledSites)
  if (on) enabledSet.add(id)
  else enabledSet.delete(id)
  if (enabledSet.size === 0) return { kind: 'last-site' }
  const enabledSites = settings.siteOrder.filter((siteId) => enabledSet.has(siteId))
  return enabledSites.length === 0 ? { kind: 'last-site' } : { kind: 'changed', settings: { enabledSites, siteOrder: [...settings.siteOrder] } }
}

export function moveSite(settings: SiteSettings, id: string, direction: 'up' | 'down'): SiteSettings {
  const index = settings.siteOrder.indexOf(id)
  if (index === -1) return settings
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= settings.siteOrder.length) return settings
  const siteOrder = [...settings.siteOrder]
  ;[siteOrder[index], siteOrder[target]] = [siteOrder[target]!, siteOrder[index]!]
  const enabledSet = new Set(settings.enabledSites)
  return { siteOrder, enabledSites: siteOrder.filter((siteId) => enabledSet.has(siteId)) }
}

export function selectAdaptersForRun(adapters: readonly SiteAdapter[], site: string | undefined, settings: SiteSettings): SiteAdapter[] {
  const byId = new Map(adapters.map((a) => [a.id, a]))
  if (site !== undefined) {
    const adapter = byId.get(site)
    if (!adapter) throw new Error(`알 수 없는 사이트입니다: ${site}`)
    return [adapter]
  }
  const enabledSet = new Set(settings.enabledSites)
  return settings.siteOrder
    .filter((id) => enabledSet.has(id))
    .map((id) => byId.get(id))
    .filter((a): a is SiteAdapter => a !== undefined)
}

export const LAST_SITE_MESSAGE = '최소 한 곳은 켜 두어야 합니다. 다른 사이트를 먼저 켜 주세요.'
