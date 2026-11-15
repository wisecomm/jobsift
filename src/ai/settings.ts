import { z } from 'zod'
import type { AiProvider, AiSettings, AiSettingsView, SearchCriteria } from '../shared/types'
import { criteriaChanged } from '../engine/criteria'
import { DEFAULT_MIN_SCORE, DEFAULT_MODEL, DEFAULT_MODELS, DEFAULT_PROVIDER } from './constants'

const PROVIDERS: readonly AiProvider[] = ['gemini', 'exaone']

export const DEFAULT_AI_SETTINGS: AiSettings = {
  provider: DEFAULT_PROVIDER,
  apiKey: '',
  model: DEFAULT_MODEL,
  keys: { gemini: '', exaone: '' },
  models: { ...DEFAULT_MODELS },
  minScore: DEFAULT_MIN_SCORE,
}

const AI_KEY = 'aiSettings'

/** The slice of chrome.storage.local this module uses, so tests need no extension runtime. */
export interface StorageArea {
  get(key: string): Promise<Record<string, unknown>>
  set(items: Record<string, unknown>): Promise<void>
}

const providerSchema = z.enum(['gemini', 'exaone'])
const aiSchema = z.object({
  provider: providerSchema.optional(),
  apiKey: z.string(),
  model: z.string(),
  keys: z.object({ gemini: z.string().optional(), exaone: z.string().optional() }).optional(),
  models: z.object({ gemini: z.string().optional(), exaone: z.string().optional() }).optional(),
  minScore: z.number(),
})

export const resolvedProvider = (settings: Pick<AiSettings, 'provider'>): AiProvider =>
  settings.provider === 'exaone' ? 'exaone' : 'gemini'

export function providerKey(settings: AiSettings, provider: AiProvider = resolvedProvider(settings)): string {
  const fromMap = settings.keys?.[provider]?.trim()
  if (fromMap !== undefined) return fromMap
  return resolvedProvider(settings) === provider ? settings.apiKey.trim() : ''
}

export function providerModel(settings: AiSettings, provider: AiProvider = resolvedProvider(settings)): string {
  const fromMap = settings.models?.[provider]?.trim()
  if (fromMap) return fromMap
  return (resolvedProvider(settings) === provider ? settings.model.trim() : '') || DEFAULT_MODELS[provider]
}

export function normalizeAiSettings(settings: AiSettings): AiSettings {
  const provider = resolvedProvider(settings)
  const minScore = Math.round(settings.minScore)
  const keys: Record<AiProvider, string> = {
    gemini: providerKey(settings, 'gemini'),
    exaone: providerKey(settings, 'exaone'),
  }
  if (!settings.keys && settings.apiKey.trim() !== '') keys[provider] = settings.apiKey.trim()

  const models: Record<AiProvider, string> = {
    gemini: providerModel(settings, 'gemini'),
    exaone: providerModel(settings, 'exaone'),
  }
  if (!settings.models) models[provider] = settings.model.trim() || DEFAULT_MODELS[provider]

  return {
    provider,
    apiKey: keys[provider],
    model: models[provider],
    keys,
    models,
    minScore: Number.isFinite(minScore) ? Math.min(100, Math.max(0, minScore)) : DEFAULT_MIN_SCORE,
  }
}

export const aiEnabled = (settings: AiSettings) => settings.apiKey !== ''

export function toAiView(raw: AiSettings): AiSettingsView {
  const normalized = normalizeAiSettings(raw)
  const provider = resolvedProvider(normalized)
  const hasKeyByProvider: Record<AiProvider, boolean> = { gemini: false, exaone: false }
  const modelsByProvider: Record<AiProvider, string> = { ...DEFAULT_MODELS }
  for (const p of PROVIDERS) {
    hasKeyByProvider[p] = Boolean(normalized.keys?.[p])
    modelsByProvider[p] = normalized.models?.[p] || DEFAULT_MODELS[p]
  }
  return {
    provider,
    hasKey: normalized.apiKey !== '',
    model: normalized.model,
    hasKeyByProvider,
    modelsByProvider,
    minScore: normalized.minScore,
  }
}

export async function loadAiSettings(area: StorageArea): Promise<AiSettings> {
  const parsed = aiSchema.safeParse((await area.get(AI_KEY))[AI_KEY])
  return parsed.success ? normalizeAiSettings(parsed.data) : DEFAULT_AI_SETTINGS
}

export async function storeAiSettings(area: StorageArea, settings: AiSettings): Promise<void> {
  await area.set({ [AI_KEY]: normalizeAiSettings(settings) })
}

/** What the page sends when saving. An empty key means "keep the saved one"; deleting is its own action. */
export interface AiInput {
  provider?: AiProvider
  apiKey: string
  model: string
  minScore: number
}

export function mergeAiInput(saved: AiSettings, input: AiInput): AiSettings {
  const base = normalizeAiSettings(saved)
  const provider = input.provider ?? resolvedProvider(base)
  const nextKeys: Record<AiProvider, string> = {
    gemini: base.keys?.gemini ?? '',
    exaone: base.keys?.exaone ?? '',
    [provider]: input.apiKey.trim() || providerKey(base, provider),
  }
  const nextModels: Record<AiProvider, string> = {
    gemini: base.models?.gemini ?? DEFAULT_MODELS.gemini,
    exaone: base.models?.exaone ?? DEFAULT_MODELS.exaone,
    [provider]: input.model.trim() || DEFAULT_MODELS[provider],
  }
  return normalizeAiSettings({
    provider,
    apiKey: nextKeys[provider],
    model: nextModels[provider],
    keys: nextKeys,
    models: nextModels,
    minScore: input.minScore,
  })
}

export function clearProviderKey(saved: AiSettings, target?: AiProvider): AiSettings {
  const base = normalizeAiSettings(saved)
  const provider = target ?? resolvedProvider(base)
  const nextKeys: Record<AiProvider, string> = {
    gemini: base.keys?.gemini ?? '',
    exaone: base.keys?.exaone ?? '',
    [provider]: '',
  }
  return normalizeAiSettings({
    ...base,
    keys: nextKeys,
    apiKey: nextKeys[resolvedProvider(base)],
  })
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
    resolvedProvider(before.ai) !== resolvedProvider(after.ai) ||
    before.ai.model !== after.ai.model
  )
}
