import { z } from 'zod'
import type { AiModelUsage, AiUsageRecord, PostingTokenUsage, TokenUsage } from '../shared/types'
import type { StorageArea } from './settings'

const AI_USAGE_KEY = 'aiUsage'

const countSchema = z.number().int().min(0)
const tokenUsageSchema = z.object({
  inputTokens: countSchema,
  outputTokens: countSchema,
  thoughtTokens: countSchema,
  cachedTokens: countSchema,
  totalTokens: countSchema,
})
const modelUsageSchema = tokenUsageSchema.extend({ requests: countSchema })
const aiUsageSchema = z.object({
  requests: countSchema,
  scoredPostings: countSchema,
  totals: tokenUsageSchema,
  byModel: z.record(z.string(), modelUsageSchema),
  updatedAt: z.string().nullable(),
})

export const emptyTokenUsage = (): TokenUsage => ({
  inputTokens: 0,
  outputTokens: 0,
  thoughtTokens: 0,
  cachedTokens: 0,
  totalTokens: 0,
})

export const emptyAiUsage = (): AiUsageRecord => ({
  requests: 0,
  scoredPostings: 0,
  totals: emptyTokenUsage(),
  byModel: {},
  updatedAt: null,
})

export function addTokenUsage(a: TokenUsage, b: TokenUsage): TokenUsage {
  return {
    inputTokens: a.inputTokens + b.inputTokens,
    outputTokens: a.outputTokens + b.outputTokens,
    thoughtTokens: a.thoughtTokens + b.thoughtTokens,
    cachedTokens: a.cachedTokens + b.cachedTokens,
    totalTokens: a.totalTokens + b.totalTokens,
  }
}

const TOKEN_FIELDS: readonly (keyof TokenUsage)[] = [
  'inputTokens',
  'outputTokens',
  'thoughtTokens',
  'cachedTokens',
  'totalTokens',
]

/** Splits one batch's exact token usage across the sites in the batch without losing tokens to rounding. */
export function splitUsageBySite(usage: TokenUsage, sites: readonly string[]): Record<string, TokenUsage> {
  if (sites.length === 0) return {}
  const counts = new Map<string, number>()
  for (const site of sites) counts.set(site, (counts.get(site) ?? 0) + 1)
  if (counts.size === 1) return { [sites[0]!]: usage }

  const entries = [...counts.entries()]
  const result = Object.fromEntries(entries.map(([site]) => [site, emptyTokenUsage()])) as Record<string, TokenUsage>
  for (const field of TOKEN_FIELDS) {
    const total = usage[field]
    let assigned = 0
    const shares = entries.map(([site, count], index) => {
      const exact = (total * count) / sites.length
      const base = Math.floor(exact)
      assigned += base
      return { site, index, base, remainder: exact - base }
    })
    const leftover = total - assigned
    const ranked = [...shares].sort((a, b) => b.remainder - a.remainder || a.index - b.index)
    for (let i = 0; i < leftover; i++) ranked[i]!.base += 1
    for (const share of shares) result[share.site]![field] = share.base
  }
  return result
}

export function mergeUsageMaps(a: Record<string, TokenUsage>, b: Record<string, TokenUsage>): Record<string, TokenUsage> {
  const merged: Record<string, TokenUsage> = { ...a }
  for (const [site, usage] of Object.entries(b)) {
    merged[site] = merged[site] ? addTokenUsage(merged[site], usage) : usage
  }
  return merged
}

/** Batch-apportioned share saved onto each kept posting; exact batch totals live in AiUsageRecord. */
export function apportionUsage(usage: TokenUsage, batchSize: number): PostingTokenUsage {
  const divisor = Math.max(1, batchSize)
  const share = (n: number) => Math.round(n / divisor)
  return {
    inputTokens: share(usage.inputTokens),
    outputTokens: share(usage.outputTokens),
    thoughtTokens: share(usage.thoughtTokens),
    cachedTokens: share(usage.cachedTokens),
    totalTokens: share(usage.totalTokens),
    batchSize: divisor,
  }
}

export async function loadAiUsage(area: StorageArea): Promise<AiUsageRecord> {
  const parsed = aiUsageSchema.safeParse((await area.get(AI_USAGE_KEY))[AI_USAGE_KEY])
  return parsed.success ? parsed.data : emptyAiUsage()
}

export async function recordAiUsage(
  area: StorageArea,
  model: string,
  scoredPostings: number,
  usage: TokenUsage,
  now: Date,
): Promise<AiUsageRecord> {
  const current = await loadAiUsage(area)
  const prevModel: AiModelUsage = current.byModel[model] ?? { ...emptyTokenUsage(), requests: 0 }
  const next: AiUsageRecord = {
    requests: current.requests + 1,
    scoredPostings: current.scoredPostings + Math.max(0, scoredPostings),
    totals: addTokenUsage(current.totals, usage),
    byModel: {
      ...current.byModel,
      [model]: { ...addTokenUsage(prevModel, usage), requests: prevModel.requests + 1 },
    },
    updatedAt: now.toISOString(),
  }
  await area.set({ [AI_USAGE_KEY]: next })
  return next
}

export async function clearAiUsage(area: StorageArea): Promise<void> {
  await area.set({ [AI_USAGE_KEY]: emptyAiUsage() })
}
