import { toScoreItems } from '../ai/prompt'
import { BATCH_SIZE } from '../ai/constants'
import { aiErrorMessage } from '../ai/gemini'
import type { AiError, ScoreFn } from '../ai/types'
import type { DiscardRecord, PendingPosting, ScoringSummary, StoredPosting } from '../shared/types'
import type { Store } from '../storage/store'

export interface ScoringDeps {
  score: ScoreFn
  /** Called before every request; resolves once the rate-limit gap has passed. */
  pace: () => Promise<void>
  minScore: number
  now: Date
}

export interface ScoringPass {
  scored: number
  kept: number
  lowScore: number
  pendingLeft: number
  error: AiError | null
}

const queueOrder = (a: PendingPosting, b: PendingPosting) =>
  a.queuedAt.localeCompare(b.queuedAt) || a.site.localeCompare(b.site) || a.externalId.localeCompare(b.externalId, undefined, { numeric: true })

/**
 * Drains the pending queue of every site batch by batch, so the batch size and request gap hold across sites. Each batch is committed as it finishes, and the first failed batch
 * ends the pass with the rest still queued, so there is no retry loop to burn the user's quota.
 */
export async function scorePending(store: Store, { score, pace, minScore, now }: ScoringDeps): Promise<ScoringPass> {
  const queue = (await store.listPending()).sort(queueOrder)
  const pass: ScoringPass = { scored: 0, kept: 0, lowScore: 0, pendingLeft: queue.length, error: null }
  const nowIso = now.toISOString()

  for (let start = 0; start < queue.length; start += BATCH_SIZE) {
    const batch = queue.slice(start, start + BATCH_SIZE)
    await pace()
    const result = await score(toScoreItems(batch))
    if (result.kind === 'error') {
      pass.error = result.error
      break
    }

    const kept: StoredPosting[] = []
    const dropped: DiscardRecord[] = []
    for (const { index, score: value, reason } of result.scores) {
      const { matchedKeywords, queuedAt, ...posting } = batch[index] as PendingPosting
      if (value >= minScore) {
        kept.push({ ...posting, matchedKeywords, status: 'new', memo: '', score: value, scoreReason: reason, collectedAt: queuedAt, updatedAt: nowIso })
      } else {
        dropped.push({ site: posting.site, externalId: posting.externalId, reason: { gate: 'lowScore', score: value }, discardedAt: nowIso, deadline: posting.deadline })
      }
    }
    await store.commitScored({ kept, dropped, resolved: batch })
    pass.scored += batch.length
    pass.kept += kept.length
    pass.lowScore += dropped.length
    pass.pendingLeft -= batch.length
  }
  return pass
}

export function toScoringSummary(pass: ScoringPass): ScoringSummary {
  const { error, ...counts } = pass
  return { ...counts, error: error ? aiErrorMessage(error) : null }
}

export const emptyPass = (): ScoringPass => ({ scored: 0, kept: 0, lowScore: 0, pendingLeft: 0, error: null })
