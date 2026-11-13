import type { Store } from '../storage/store'
import type { PendingPosting, SearchCriteria, StoredPosting } from '../shared/types'
import { evaluate } from './evaluate'

export interface ChangeResult {
  /** Postings the new rules turned away. */
  removed: number
  /** Postings now waiting for an AI score (AI on). */
  queued: number
}

const toPending = ({ status, memo, score, scoreReason, collectedAt, updatedAt, ...rest }: StoredPosting, matchedKeywords: string[]): PendingPosting => ({
  ...rest,
  matchedKeywords,
  queuedAt: collectedAt,
})

const fromPending = ({ queuedAt, matchedKeywords, ...rest }: PendingPosting, now: Date): StoredPosting => ({
  ...rest,
  matchedKeywords,
  status: 'new',
  memo: '',
  score: null,
  scoreReason: null,
  collectedAt: queuedAt,
  updatedAt: now.toISOString(),
})

/**
 * Re-applies the rules and the AI mode to what is stored. Only untouched postings follow: `new` ones without a memo,
 * and everything pending. A posting the user saved, applied to, dismissed, or wrote a memo on keeps its place, since
 * moving it through the queue would lose what they entered. Every move writes the destination before deleting the source,
 * so an interrupted run duplicates at worst and the next save finishes it.
 */
export async function applyCriteriaChange(
  store: Store,
  site: string,
  criteria: SearchCriteria,
  { aiOn }: { aiOn: boolean },
  now: Date,
): Promise<ChangeResult> {
  await Promise.all([store.clearDiscards(), store.clearCollectState()])
  const nowIso = now.toISOString()
  const result: ChangeResult = { removed: 0, queued: 0 }
  const options = { requireKeywordMatch: !aiOn }
  // Read before moving postings in, so those are not processed twice.
  const waiting = await store.listPending(site)

  const reject = async (posting: StoredPosting | PendingPosting, reason: Extract<ReturnType<typeof evaluate>, { kind: 'reject' }>['reason']) => {
    await store.putDiscard({ site: posting.site, externalId: posting.externalId, reason, discardedAt: nowIso, deadline: posting.deadline })
    result.removed++
  }

  for (const posting of await store.listPostings(site)) {
    if (posting.status !== 'new') continue
    const outcome = evaluate(posting, criteria, now, options)
    if (outcome.kind === 'reject') {
      await reject(posting, outcome.reason)
      await store.deletePosting(posting)
    } else if (aiOn && posting.memo === '') {
      await store.putPending(toPending(posting, outcome.matchedKeywords))
      await store.deletePosting(posting)
      result.queued++
    } else {
      await store.putPosting({ ...posting, matchedKeywords: outcome.matchedKeywords, score: aiOn ? posting.score : null, scoreReason: aiOn ? posting.scoreReason : null, updatedAt: nowIso })
    }
  }

  for (const posting of waiting) {
    const outcome = evaluate(posting, criteria, now, options)
    if (outcome.kind === 'reject') {
      await reject(posting, outcome.reason)
    } else if (aiOn) {
      await store.putPending({ ...posting, matchedKeywords: outcome.matchedKeywords })
      result.queued++
      continue
    } else {
      await store.putPosting({ ...fromPending(posting, now), matchedKeywords: outcome.matchedKeywords })
    }
    await store.deletePending([posting])
  }
  return result
}
