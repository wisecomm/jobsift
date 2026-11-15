import { postingSources, type PendingPosting, type RejectReason, type SearchCriteria } from '../shared/types'
import type { Store } from '../storage/store'
import { evaluate } from './evaluate'
import { toDiscardRecords, toPendingPosting, toStoredPosting } from './postingRecords'
import { cleanKeywordList, siteKeywords } from './siteSettings'

export interface ChangeResult {
  /** Postings the new rules turned away. */
  removed: number
  /** Postings now waiting for an AI score (AI on). */
  queued: number
}

/**
 * Prepares the store for updated rules or AI settings so changes take effect from the next collection onward.
 * Already stored postings (`store.listPostings()`) have already reached the postings list and are never removed,
 * re-queued, or reset. Clears discards and collect state for future runs, and re-evaluates only unfinished
 * `pending` postings so none violate the new rules or stay stranded when AI is turned off.
 */
export async function applyCriteriaChange(
  store: Store,
  criteria: SearchCriteria,
  { aiOn, keywordsBySite }: { aiOn: boolean; keywordsBySite?: Record<string, readonly string[]> },
  now: Date,
): Promise<ChangeResult> {
  await Promise.all([store.clearDiscards(), store.clearCollectState()])
  const nowIso = now.toISOString()
  const result: ChangeResult = { removed: 0, queued: 0 }
  const options = { requireKeywordMatch: !aiOn }
  const siteSettingsSlice = keywordsBySite ? { keywordsBySite: Object.fromEntries(Object.entries(keywordsBySite).map(([k, v]) => [k, [...v]])) } : undefined
  const criteriaFor = (posting: PendingPosting): SearchCriteria => {
    if (!siteSettingsSlice) return criteria
    const merged = cleanKeywordList(postingSources(posting).flatMap((source) => siteKeywords(source.site, criteria.keywords, siteSettingsSlice)))
    return { ...criteria, keywords: merged }
  }
  const waiting: PendingPosting[] = await store.listPending()

  const discardAllSources = async (posting: PendingPosting, reason: RejectReason) => {
    await Promise.all(toDiscardRecords(posting, reason, nowIso).map((record) => store.putDiscard(record)))
    result.removed++
  }

  for (const posting of waiting) {
    const outcome = evaluate(posting, criteriaFor(posting), now, options)
    if (outcome.kind === 'reject') {
      await discardAllSources(posting, outcome.reason)
      await store.deletePending([posting])
      continue
    }
    if (aiOn) {
      await store.putPending({ ...posting, matchedKeywords: outcome.matchedKeywords })
      result.queued++
      continue
    }
    await store.putPosting(
      toStoredPosting(posting, {
        matchedKeywords: outcome.matchedKeywords,
        score: null,
        scoreReason: null,
        collectedAt: posting.queuedAt,
        updatedAt: nowIso,
      }),
    )
    await store.deletePending([posting])
  }

  return result
}
