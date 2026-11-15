import type { SiteAdapter } from '../adapter/schema'
import { addTokenUsage, mergeUsageMaps } from '../ai/usage'
import type { CollectionReport, SearchCriteria, SiteRunStatus, TokenUsage } from '../shared/types'
import type { Store } from '../storage/store'
import { runCollection, type RunDeps } from './runCollection'
import { scorePending, toScoringSummary, type ScoringDeps, type ScoringPass } from './scorePending'

export interface RunAllDeps extends Omit<RunDeps, 'aiOn' | 'maxItems' | 'onProgress'> {
  /** Present exactly when AI is on. */
  scoring?: ScoringDeps
  /** Optional per-site keyword scan cap (in postings). */
  maxItemsFor?: (siteId: string) => number | undefined
  /** Optional per-site effective keyword list (e.g. shared keywords + site additions). */
  keywordsFor?: (siteId: string) => readonly string[]
  onProgress?: (text: string) => void
}

const sum = (passes: ScoringPass[], field: 'scored' | 'kept' | 'lowScore') => passes.reduce((total, pass) => total + pass[field], 0)

function sumUsage(passes: ScoringPass[]): TokenUsage | undefined {
  let total: TokenUsage | undefined
  for (const pass of passes) {
    if (!pass.usage) continue
    total = total ? addTokenUsage(total, pass.usage) : pass.usage
  }
  return total
}

function sumUsageBySite(passes: ScoringPass[]): Record<string, TokenUsage> {
  let total: Record<string, TokenUsage> = {}
  for (const pass of passes) {
    if (pass.usageBySite) total = mergeUsageMaps(total, pass.usageBySite)
  }
  return total
}

/**
 * Collects the given sites one after another. A site that throws is reported and the rest still run.
 * Scoring is one pass over every pending posting, before fetching (so leftovers from an interrupted run are not
 * stuck behind new ones) and again after, so the batch size and request gap hold across sites.
 */
export async function runAllSites(
  adapters: readonly SiteAdapter[],
  criteria: SearchCriteria,
  store: Store,
  { scoring, maxItemsFor, keywordsFor, onProgress, ...deps }: RunAllDeps,
): Promise<CollectionReport> {
  const firstPass = scoring ? await scorePending(store, scoring) : null

  const runs: SiteRunStatus[] = []
  for (const [index, adapter] of adapters.entries()) {
    if (deps.signal?.aborted) break
    const at = deps.now.toISOString()
    try {
      const siteKeywordList = keywordsFor?.(adapter.id)
      const siteCriteria = siteKeywordList ? { ...criteria, keywords: [...siteKeywordList] } : criteria
      const summary = await runCollection(adapter, siteCriteria, store, {
        ...deps,
        aiOn: scoring !== undefined,
        maxItems: maxItemsFor?.(adapter.id),
        onProgress: ({ keyword, page, maxPages, collected }) =>
          onProgress?.(`${adapter.name} (${index + 1}/${adapters.length}) · "${keyword}" ${page}/${maxPages}페이지 수집 중 (${collected}건)…`),
      })
      runs.push({ site: adapter.id, at, result: { kind: 'ok', summary } })
    } catch (error) {
      runs.push({ site: adapter.id, at, result: { kind: 'error', message: error instanceof Error ? error.message : String(error) } })
    }
  }

  if (!scoring || !firstPass) return { runs, scoring: null }
  // A failed first pass (a 429, say) means the same request would fail again now, so the new postings just wait in the queue.
  const secondPass = firstPass.error || deps.signal?.aborted ? null : await scorePending(store, scoring)
  const passes = [firstPass, secondPass].filter((pass): pass is ScoringPass => pass !== null)
  const usage = sumUsage(passes)
  const usageBySite = sumUsageBySite(passes)
  for (const run of runs) {
    if (run.result.kind === 'ok' && run.result.summary.aiOn) {
      const siteUsage = usageBySite[run.site]
      if (siteUsage) run.result.summary.tokenUsage = siteUsage
    }
  }
  return {
    runs,
    scoring: toScoringSummary({
      scored: sum(passes, 'scored'),
      kept: sum(passes, 'kept'),
      lowScore: sum(passes, 'lowScore'),
      pendingLeft: (await store.listPending()).length,
      ...(usage ? { usage } : {}),
      error: passes.find((pass) => pass.error)?.error ?? null,
    }, scoring.provider),
  }
}
