import { z } from 'zod'
import type { AiSettings, AiSettingsView, SearchCriteria } from '../shared/types'
import { criteriaChanged } from '../engine/criteria'
import { DEFAULT_MIN_SCORE, DEFAULT_MODEL } from './constants'

export const DEFAULT_AI_SETTINGS: AiSettings = { apiKey: '', model: DEFAULT_MODEL, minScore: DEFAULT_MIN_SCORE }

const AI_KEY = 'aiSettings'

/** The slice of chrome.storage.local this module uses, so tests need no extension runtime. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

const aiSchema = z.object({ apiKey: z.string(), model: z.string(), minScore: z.number() })

export function normalizeAiSettings(settings: AiSettings): AiSettings {
  const minScore = Math.round(settings.minScore)
  return {
    apiKey: settings.apiKey.trim(),
    model: settings.model.trim() || DEFAULT_MODEL,
    minScore: Number.isFinite(minScore) ? Math.min(100, Math.max(0, minScore)) : DEFAULT_MIN_SCORE,
  }
}

export const aiEnabled = (settings: AiSettings) => settings.apiKey !== ''

export function toAiView({ apiKey, model, minScore }: AiSettings): AiSettingsView {
  return { hasKey: apiKey !== '', model, minScore }
}

export async function loadAiSettings(area: StorageArea): Promise<AiSettings> {
  const parsed = aiSchema.safeParse((await area.get(AI_KEY))[AI_KEY])
  return parsed.success ? normalizeAiSettings(parsed.data) : DEFAULT_AI_SETTINGS
}

export async function storeAiSettings(area: StorageArea, settings: AiSettings): Promise<void> {
  await area.set({ [AI_KEY]: settings })
}

/** What the page sends when saving. An empty key means "keep the saved one"; deleting is its own action. */
export interface AiInput {
  apiKey: string
  model: string
  minScore: number
}

export function mergeAiInput(saved: AiSettings, input: AiInput): AiSettings {
  return normalizeAiSettings({ ...input, apiKey: input.apiKey.trim() || saved.apiKey })
}

export interface SettingsSnapshot {
  criteria: SearchCriteria
  ai: AiSettings
}

/**
 * A rule change, an AI mode switch, or, with AI on, a change to what the score depends on.
 * With AI off the description, model and minimum score affect nothing, so editing them must not force a re-collect.
 */
export function settingsChanged(before: SettingsSnapshot, after: SettingsSnapshot): boolean {
  if (criteriaChanged(before.criteria, after.criteria)) return true
  if (aiEnabled(before.ai) !== aiEnabled(after.ai)) return true
  if (!aiEnabled(after.ai)) return false
  return (
    before.criteria.description.trim() !== after.criteria.description.trim() ||
    before.ai.minScore !== after.ai.minScore ||
    before.ai.model !== after.ai.model
  )
}
