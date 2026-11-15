import { z } from 'zod'
import type { StorageArea } from '../ai/settings'
import { addTokenUsage } from '../ai/usage'
import type { SiteRunStatus, TokenUsage } from '../shared/types'

const RUNS_KEY = 'siteRuns'

const count = z.number().int().min(0)
const tokenUsageSchema = z.object({
  inputTokens: count,
  outputTokens: count,
  thoughtTokens: count,
  cachedTokens: count,
  totalTokens: count,
})
const summarySchema = z.object({
  scanned: count,
  saved: count,
  queued: count,
  aiOn: z.boolean(),
  discarded: count,
  discardedByGate: z.object({ expired: count, keywordMismatch: count, location: count, career: count, lowScore: count }),
  expiredMarked: count,
  stopReasons: z.record(z.string(), z.enum(['cutoff', 'known', 'exhausted', 'page-cap', 'error'])),
  errors: z.record(z.string(), z.string()),
  maxItems: count.optional(),
  tokenUsage: tokenUsageSchema.optional(),
})
const statusSchema = z.object({
  site: z.string(),
  at: z.string(),
  result: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('ok'), summary: summarySchema }),
    z.object({ kind: z.literal('error'), message: z.string() }),
  ]),
})

/** Latest status per site id. An entry that no longer parses is dropped, so a format change never breaks the tab. */
export async function loadSiteRuns(area: StorageArea): Promise<Record<string, SiteRunStatus>> {
  const stored = (await area.get(RUNS_KEY))[RUNS_KEY]
  const runs: Record<string, SiteRunStatus> = {}
  if (typeof stored !== 'object' || stored === null) return runs
  for (const value of Object.values(stored)) {
    const parsed = statusSchema.safeParse(value)
    if (parsed.success) runs[parsed.data.site] = parsed.data
  }
  return runs
}

export async function recordSiteRuns(area: StorageArea, runs: readonly SiteRunStatus[]): Promise<void> {
  const merged = await loadSiteRuns(area)
  for (const run of runs) merged[run.site] = run
  await area.set({ [RUNS_KEY]: merged })
}

/** Adds tokens from a manual `scorePending` pass onto each affected site's latest ok run summary. */
export async function addSiteRunUsage(area: StorageArea, usageBySite: Record<string, TokenUsage> | undefined): Promise<void> {
  if (!usageBySite || Object.keys(usageBySite).length === 0) return
  const runs = await loadSiteRuns(area)
  let changed = false
  for (const [site, usage] of Object.entries(usageBySite)) {
    const run = runs[site]
    if (!run || run.result.kind !== 'ok') continue
    const prev = run.result.summary.tokenUsage
    runs[site] = {
      ...run,
      result: {
        kind: 'ok',
        summary: {
          ...run.result.summary,
          aiOn: true,
          tokenUsage: prev ? addTokenUsage(prev, usage) : usage,
        },
      },
    }
    changed = true
  }
  if (changed) await area.set({ [RUNS_KEY]: runs })
}

export async function clearSiteRuns(area: StorageArea): Promise<void> {
  await area.set({ [RUNS_KEY]: {} })
}
