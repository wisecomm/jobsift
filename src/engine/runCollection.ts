import type { SiteAdapter } from '../adapter/schema'
import type { CollectionSummary, RejectGate, SearchCriteria } from '../shared/types'
import type { Store } from '../storage/store'
import { collect } from './collect'
import { evaluate } from './evaluate'
import { scorePending, toScoringSummary, type ScoringDeps, type ScoringPass } from './scorePending'

const DAY_MS = 24 * 60 * 60 * 1000
const DEADLINE_LESS_DISCARD_DAYS = 60

export interface RunDeps {
  fetchHtml: (url: string) => Promise<string>
  now: Date
  sleep?: (ms: number) => Promise<void>
  /** Present exactly when AI is on. Without it the keyword gate stays on and nothing is queued. */
  scoring?: ScoringDeps
}

const sum = (passes: ScoringPass[], field: 'scored' | 'kept' | 'lowScore') => passes.reduce((total, pass) => total + pass[field], 0)

export const emptyGateCounts = (): Record<RejectGate, number> => ({
  expired: 0,
  excludeKeyword: 0,
  keywordMismatch: 0,
  location: 0,
  career: 0,
  lowScore: 0,
})

async function pruneDiscards(store: Store, site: string, now: Date): Promise<void> {
  const stale = (await store.listDiscards(site)).filter((record) =>
    record.deadline !== null
      ? Date.parse(record.deadline) < now.getTime()
      : Date.parse(record.discardedAt) < now.getTime() - DEADLINE_LESS_DISCARD_DAYS * DAY_MS,
  )
  await store.deleteDiscards(stale)
}

export async function runCollection(
  adapter: SiteAdapter,
  criteria: SearchCriteria,
  store: Store,
  { fetchHtml, now, sleep, scoring }: RunDeps,
): Promise<CollectionSummary> {
  const site = adapter.id
  const nowIso = now.toISOString()
  const expiredMarked = await store.markExpired(site, now)
  await pruneDiscards(store, site, now)

  // Scored before fetching, so postings left over from an interrupted run are not stuck behind new ones.
  const firstPass = scoring ? await scorePending(store, site, scoring) : null

  const knownIds = await store.knownIds(site)
  const firstRunCutoff = new Date(now.getTime() - criteria.initialDays * DAY_MS)
  const cutoffs = new Map<string, Date>()
  for (const keyword of criteria.keywords) {
    const state = await store.getCollectState(site, keyword)
    cutoffs.set(keyword, state ? new Date(state.lastCollectedAt) : firstRunCutoff)
  }

  const { postings, stopReasons, errors } = await collect(adapter, criteria, {
    fetchHtml,
    knownIds,
    cutoffFor: (keyword) => cutoffs.get(keyword) ?? firstRunCutoff,
    sleep,
  })

  const summary: CollectionSummary = {
    scanned: postings.length,
    saved: 0,
    queued: 0,
    scoring: null,
    discarded: 0,
    discardedByGate: emptyGateCounts(),
    expiredMarked,
    stopReasons,
    errors,
  }
  for (const posting of postings) {
    const result = evaluate(posting, criteria, now, { requireKeywordMatch: !scoring })
    if (result.kind === 'pass' && scoring) {
      await store.putPending({ ...posting, matchedKeywords: result.matchedKeywords, queuedAt: nowIso })
      summary.queued++
    } else if (result.kind === 'pass') {
      const stored = await store.addPosting({
        ...posting,
        status: 'new',
        memo: '',
        matchedKeywords: result.matchedKeywords,
        score: null,
        scoreReason: null,
        collectedAt: nowIso,
        updatedAt: nowIso,
      })
      if (stored) summary.saved++
    } else {
      await store.putDiscard({
        site: posting.site,
        externalId: posting.externalId,
        reason: result.reason,
        discardedAt: nowIso,
        deadline: posting.deadline,
      })
      summary.discarded++
      summary.discardedByGate[result.reason.gate]++
    }
  }

  for (const keyword of criteria.keywords) {
    if (stopReasons[keyword] !== 'error') await store.putCollectState({ site, keyword, lastCollectedAt: nowIso })
  }

  if (scoring && firstPass) {
    // A failed first pass (a 429, say) means the same request would fail again now, so the new postings just wait in the queue.
    const secondPass = firstPass.error ? null : await scorePending(store, site, scoring)
    const passes = [firstPass, secondPass].filter((pass): pass is ScoringPass => pass !== null)
    summary.scoring = toScoringSummary({
      scored: sum(passes, 'scored'),
      kept: sum(passes, 'kept'),
      lowScore: sum(passes, 'lowScore'),
      pendingLeft: (await store.listPending(site)).length,
      error: passes.find((pass) => pass.error)?.error ?? null,
    })
  }
  return summary
}
