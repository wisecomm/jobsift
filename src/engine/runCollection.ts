import type { SiteAdapter } from '../adapter/schema'
import { DAY_MS } from '../shared/date'
import type { CollectionSummary, PendingPosting, RejectGate, SearchCriteria, StoredPosting } from '../shared/types'
import type { Store } from '../storage/store'
import { collect } from './collect'
import { addSource, dedupKey } from './dedup'
import { evaluate } from './evaluate'

const DEADLINE_LESS_DISCARD_DAYS = 60

export interface RunDeps {
  fetchHtml: (url: string) => Promise<string>
  now: Date
  sleep?: (ms: number) => Promise<void>
  /** AI on: the keyword gate is off and passes wait in the queue for scoring. Scoring itself belongs to runAllSites. */
  aiOn: boolean
}

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
  { fetchHtml, now, sleep, aiOn }: RunDeps,
): Promise<CollectionSummary> {
  const site = adapter.id
  const nowIso = now.toISOString()
  const expiredMarked = await store.markExpired(site, now)
  await pruneDiscards(store, site, now)

  const knownIds = await store.knownIds(site)
  const firstRunCutoff = new Date(now.getTime() - criteria.initialDays * DAY_MS)
  const cutoffs = new Map<string, Date>()
  const neverCollected = new Set<string>()
  for (const keyword of criteria.keywords) {
    const state = await store.getCollectState(site, keyword)
    cutoffs.set(keyword, state ? new Date(state.lastCollectedAt) : firstRunCutoff)
    if (!state) neverCollected.add(keyword)
  }

  const { postings, stopReasons, errors } = await collect(adapter, criteria, {
    fetchHtml,
    knownIds,
    cutoffFor: (keyword) => cutoffs.get(keyword) ?? firstRunCutoff,
    scanPastKnown: (keyword) => neverCollected.has(keyword),
    sleep,
  })

  const [existingPostings, existingPending] = await Promise.all([store.listPostings(), store.listPending()])
  const storedByKey = new Map<string, StoredPosting>(existingPostings.map((p) => [dedupKey(p), p]))
  const pendingByKey = new Map<string, PendingPosting>(existingPending.map((p) => [dedupKey(p), p]))

  const summary: CollectionSummary = {
    scanned: postings.length,
    saved: 0,
    queued: 0,
    aiOn,
    discarded: 0,
    discardedByGate: emptyGateCounts(),
    expiredMarked,
    stopReasons,
    errors,
  }
  for (const posting of postings) {
    const result = evaluate(posting, criteria, now, { requireKeywordMatch: !aiOn })
    if (result.kind === 'pass') {
      const key = dedupKey(posting)
      const matchStored = storedByKey.get(key)
      if (matchStored && matchStored.site !== posting.site) {
        const merged = addSource(matchStored, posting, result.matchedKeywords)
        if (merged) {
          await store.putPosting(merged)
          storedByKey.set(key, merged)
        }
        continue
      }
      const matchPending = pendingByKey.get(key)
      if (matchPending && matchPending.site !== posting.site) {
        const merged = addSource(matchPending, posting, result.matchedKeywords)
        if (merged) {
          await store.putPending(merged)
          pendingByKey.set(key, merged)
        }
        continue
      }
    }

    if (result.kind === 'pass' && aiOn) {
      const item: PendingPosting = { ...posting, matchedKeywords: result.matchedKeywords, queuedAt: nowIso }
      await store.putPending(item)
      pendingByKey.set(dedupKey(item), item)
      summary.queued++
    } else if (result.kind === 'pass') {
      const item: StoredPosting = {
        ...posting,
        status: 'new',
        memo: '',
        matchedKeywords: result.matchedKeywords,
        score: null,
        scoreReason: null,
        collectedAt: nowIso,
        updatedAt: nowIso,
      }
      const stored = await store.addPosting(item)
      if (stored) {
        storedByKey.set(dedupKey(item), item)
        summary.saved++
      }
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

  return summary
}
