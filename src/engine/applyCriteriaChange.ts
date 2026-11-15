import type { PendingPosting, RejectReason, SearchCriteria, StoredPosting } from '../shared/types'
import type { Store } from '../storage/store'
import { evaluate } from './evaluate'
import { toDiscardRecords, toPendingPosting, toStoredPosting } from './postingRecords'

export interface ChangeResult {
  /** Postings the new rules turned away. */
  removed: number
  /** Postings now waiting for an AI score (AI on). */
  queued: number
}

/**
 * Re-applies the rules and the AI mode to what is stored, for every site. Only untouched postings follow: `new` ones without a memo,
 * and everything pending. A posting the user saved, applied to, dismissed, or wrote a memo on keeps its place, since
 * moving it through the queue would lose what they entered. Every move writes the destination before deleting the source,
 * so an interrupted run duplicates at worst and the next save finishes it.
 */
export async function applyCriteriaChange(
  store: Store,
  criteria: SearchCriteria,
  { aiOn }: { aiOn: boolean },
  now: Date,
): Promise<ChangeResult> {
  await Promise.all([store.clearDiscards(), store.clearCollectState()])
  const nowIso = now.toISOString()
  const result: ChangeResult = { removed: 0, queued: 0 }
  const options = { requireKeywordMatch: !aiOn }
  // Read before moving postings in, so those are not processed twice.
  const waiting: PendingPosting[] = await store.listPending()

  const discardAllSources = async (posting: StoredPosting | PendingPosting, reason: RejectReason) => {
    await Promise.all(toDiscardRecords(posting, reason, nowIso).map((record) => store.putDiscard(record)))
    result.removed++
  }

  for (const posting of await store.listPostings()) {
    if (posting.status !== 'new') continue
    const outcome = evaluate(posting, criteria, now, options)
    if (outcome.kind === 'reject') {
      await discardAllSources(posting, outcome.reason)
      await store.deletePosting(posting)
      continue
    }
    if (aiOn && posting.memo === '') {
      await store.putPending(toPendingPosting(posting, outcome.matchedKeywords, posting.collectedAt))
      await store.deletePosting(posting)
      result.queued++
      continue
    }
    const { tokenUsage: _droppedUsage, ...withoutUsage } = posting
    await store.putPosting({
      ...withoutUsage,
      matchedKeywords: outcome.matchedKeywords,
      score: aiOn ? posting.score : null,
      scoreReason: aiOn ? posting.scoreReason : null,
      ...(aiOn && posting.tokenUsage ? { tokenUsage: posting.tokenUsage } : {}),
      updatedAt: nowIso,
    })
  }

  for (const posting of waiting) {
    const outcome = evaluate(posting, criteria, now, options)
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
