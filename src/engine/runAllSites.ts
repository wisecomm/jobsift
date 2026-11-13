import type { SiteAdapter } from '../adapter/schema'
import type { CollectionReport, SearchCriteria, SiteRunStatus } from '../shared/types'
import type { Store } from '../storage/store'
import { runCollection, type RunDeps } from './runCollection'
import { scorePending, toScoringSummary, type ScoringDeps, type ScoringPass } from './scorePending'

export interface RunAllDeps extends Omit<RunDeps, 'aiOn'> {
  /** Present exactly when AI is on. */
  scoring?: ScoringDeps
}

const sum = (passes: ScoringPass[], field: 'scored' | 'kept' | 'lowScore') => passes.reduce((total, pass) => total + pass[field], 0)

/**
 * Collects the given sites one after another. A site that throws is reported and the rest still run.
 * Scoring is one pass over every pending posting, before fetching (so leftovers from an interrupted run are not
 * stuck behind new ones) and again after, so the batch size and request gap hold across sites.
 */
export async function runAllSites(
  adapters: readonly SiteAdapter[],
  criteria: SearchCriteria,
  store: Store,
  { scoring, ...deps }: RunAllDeps,
): Promise<CollectionReport> {
  const firstPass = scoring ? await scorePending(store, scoring) : null

  const runs: SiteRunStatus[] = []
  for (const adapter of adapters) {
    const at = deps.now.toISOString()
    try {
      const summary = await runCollection(adapter, criteria, store, { ...deps, aiOn: scoring !== undefined })
      runs.push({ site: adapter.id, at, result: { kind: 'ok', summary } })
    } catch (error) {
      runs.push({ site: adapter.id, at, result: { kind: 'error', message: error instanceof Error ? error.message : String(error) } })
    }
  }

  if (!scoring || !firstPass) return { runs, scoring: null }
  // A failed first pass (a 429, say) means the same request would fail again now, so the new postings just wait in the queue.
  const secondPass = firstPass.error ? null : await scorePending(store, scoring)
  const passes = [firstPass, secondPass].filter((pass): pass is ScoringPass => pass !== null)
  return {
    runs,
    scoring: toScoringSummary({
      scored: sum(passes, 'scored'),
      kept: sum(passes, 'kept'),
      lowScore: sum(passes, 'lowScore'),
      pendingLeft: (await store.listPending()).length,
      error: passes.find((pass) => pass.error)?.error ?? null,
    }),
  }
}
