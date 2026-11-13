import { z } from 'zod'
import type { StorageArea } from '../ai/settings'
import type { SiteSettings } from '../shared/types'

const SETTINGS_KEY = 'siteSettings'

const rawSchema = z.object({ enabledSites: z.array(z.string()) })

export const defaultSiteSettings = (availableIds: readonly string[]): SiteSettings => ({ enabledSites: [...availableIds] })

/** Ids that no adapter owns are dropped, and an empty result falls back to every site, so collection never has nothing to run. */
export function parseSiteSettings(raw: unknown, availableIds: readonly string[]): SiteSettings {
  const parsed = rawSchema.safeParse(raw)
  if (!parsed.success) return defaultSiteSettings(availableIds)
  const known = new Set(availableIds)
  const enabledSites = [...new Set(parsed.data.enabledSites)].filter((id) => known.has(id))
  return enabledSites.length > 0 ? { enabledSites } : defaultSiteSettings(availableIds)
}

export async function loadSiteSettings(area: StorageArea, availableIds: readonly string[]): Promise<SiteSettings> {
  return parseSiteSettings((await area.get(SETTINGS_KEY))[SETTINGS_KEY], availableIds)
}

export async function storeSiteSettings(area: StorageArea, settings: SiteSettings): Promise<void> {
  await area.set({ [SETTINGS_KEY]: settings })
}

export type ToggleResult = { kind: 'changed'; settings: SiteSettings } | { kind: 'last-site' }

export function toggleSite(settings: SiteSettings, id: string, on: boolean): ToggleResult {
  const rest = settings.enabledSites.filter((enabled) => enabled !== id)
  if (on) return { kind: 'changed', settings: { enabledSites: [...rest, id] } }
  return rest.length === 0 ? { kind: 'last-site' } : { kind: 'changed', settings: { enabledSites: rest } }
}

export const LAST_SITE_MESSAGE = '최소 한 곳은 켜 두어야 합니다. 다른 사이트를 먼저 켜 주세요.'
