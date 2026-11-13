import { z } from 'zod'
import type { StorageArea } from '../ai/settings'
import type { SiteRunStatus } from '../shared/types'

const RUNS_KEY = 'siteRuns'

const count = z.number().int().min(0)
const summarySchema = z.object({
  scanned: count,
  saved: count,
  queued: count,
  aiOn: z.boolean(),
  discarded: count,
  discardedByGate: z.object({ expired: count, excludeKeyword: count, keywordMismatch: count, location: count, career: count, lowScore: count }),
  expiredMarked: count,
  stopReasons: z.record(z.string(), z.enum(['cutoff', 'known', 'exhausted', 'page-cap', 'error'])),
  errors: z.record(z.string(), z.string()),
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

export async function clearSiteRuns(area: StorageArea): Promise<void> {
  await area.set({ [RUNS_KEY]: {} })
}
