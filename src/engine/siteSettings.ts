import { z } from 'zod'
import type { SiteAdapter } from '../adapter/schema'
import type { StorageArea } from '../ai/settings'
import type { SiteSettings } from '../shared/types'

const SETTINGS_KEY = 'siteSettings'

const rawSchema = z.object({
  enabledSites: z.array(z.string()),
  siteOrder: z.array(z.string()).optional(),
  maxItemsBySite: z.record(z.string(), z.number()).optional(),
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

function normalizeMaxItems(raw: Record<string, number> | undefined, availableIds: readonly string[]): Record<string, number> | undefined {
  if (!raw) return undefined
  const known = new Set(availableIds)
  const cleaned: Record<string, number> = {}
  for (const [id, value] of Object.entries(raw)) {
    if (!known.has(id) || !Number.isFinite(value)) continue
    const count = Math.round(value)
    if (count >= 1) cleaned[id] = count
  }
  return Object.keys(cleaned).length > 0 ? cleaned : undefined
}

export const DEFAULT_MAX_ITEMS = 2000

export const defaultSiteSettings = (availableIds: readonly string[]): SiteSettings => ({
  enabledSites: [...availableIds],
  siteOrder: [...availableIds],
})

export const defaultSiteMaxItems = (_adapter?: Pick<SiteAdapter, 'search'>): number => DEFAULT_MAX_ITEMS

export const siteMaxItems = (adapter: Pick<SiteAdapter, 'id'> | string, settings: SiteSettings): number => {
  const id = typeof adapter === 'string' ? adapter : adapter.id
  return settings.maxItemsBySite?.[id] ?? DEFAULT_MAX_ITEMS
}

/** Ids that no adapter owns are dropped, and an empty result falls back to every site, so collection never has nothing to run. */
export function parseSiteSettings(raw: unknown, availableIds: readonly string[]): SiteSettings {
  const parsed = rawSchema.safeParse(raw)
  if (!parsed.success) return defaultSiteSettings(availableIds)
  const siteOrder = normalizeOrder(parsed.data.siteOrder ?? [], availableIds)
  const enabledSet = new Set(parsed.data.enabledSites)
  const enabledSites = siteOrder.filter((id) => enabledSet.has(id))
  const maxItemsBySite = normalizeMaxItems(parsed.data.maxItemsBySite, availableIds)
  const base: SiteSettings =
    enabledSites.length > 0 ? { enabledSites, siteOrder } : { enabledSites: [...siteOrder], siteOrder }
  return maxItemsBySite ? { ...base, maxItemsBySite } : base
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
  return enabledSites.length === 0 ? { kind: 'last-site' } : { kind: 'changed', settings: { ...settings, enabledSites, siteOrder: [...settings.siteOrder] } }
}

export function moveSite(settings: SiteSettings, id: string, direction: 'up' | 'down'): SiteSettings {
  const index = settings.siteOrder.indexOf(id)
  if (index === -1) return settings
  const target = direction === 'up' ? index - 1 : index + 1
  if (target < 0 || target >= settings.siteOrder.length) return settings
  const siteOrder = [...settings.siteOrder]
  ;[siteOrder[index], siteOrder[target]] = [siteOrder[target]!, siteOrder[index]!]
  const enabledSet = new Set(settings.enabledSites)
  return { ...settings, siteOrder, enabledSites: siteOrder.filter((siteId) => enabledSet.has(siteId)) }
}

export function setSiteMaxItems(settings: SiteSettings, id: string, maxItems: number): SiteSettings {
  const count = Math.max(1, Math.round(maxItems))
  if (!Number.isFinite(count)) return settings
  return {
    ...settings,
    maxItemsBySite: { ...(settings.maxItemsBySite ?? {}), [id]: count },
  }
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
