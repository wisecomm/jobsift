import { BATCH_SIZE } from '../ai/constants'
import { formatAiError } from '../ai/parseScores'
import { toScoreItems } from '../ai/prompt'
import type { AiError, ScoreFn } from '../ai/types'
import { addTokenUsage, apportionUsage, mergeUsageMaps, splitUsageBySite } from '../ai/usage'
import type { AiProvider, DiscardRecord, PendingPosting, ScoringSummary, StoredPosting, TokenUsage } from '../shared/types'
import type { Store } from '../storage/store'
import { toDiscardRecords, toStoredPosting } from './postingRecords'

export interface ScoringDeps {
  score: ScoreFn
  /** Called before every request; resolves once the rate-limit gap has passed. */
  pace: () => Promise<void>
  minScore: number
  now: Date
  provider?: AiProvider
  /** Persists exact batch token usage as each batch completes. */
  onUsage?: (usage: TokenUsage, scoredCount: number) => Promise<void> | void
  signal?: AbortSignal
  onProgress?: (progress: { scored: number; total: number }) => void
  /** Called right after each scored batch is committed to the store. */
  onBatchCommitted?: () => void
}

export interface ScoringPass {
  scored: number
  kept: number
  lowScore: number
  pendingLeft: number
  usage?: TokenUsage
  usageBySite?: Record<string, TokenUsage>
  error: AiError | null
}

const queueOrder = (a: PendingPosting, b: PendingPosting) =>
  a.queuedAt.localeCompare(b.queuedAt) || a.site.localeCompare(b.site) || a.externalId.localeCompare(b.externalId, undefined, { numeric: true })

/**
 * Drains the pending queue of every site batch by batch, so the batch size and request gap hold across sites. Each batch is committed as it finishes, and the first failed batch
 * ends the pass with the rest still queued, so there is no retry loop to burn the user's quota.
 */
export async function scorePending(store: Store, { score, pace, minScore, now, onUsage, signal, onProgress, onBatchCommitted }: ScoringDeps): Promise<ScoringPass> {
  const queue = (await store.listPending()).sort(queueOrder)
  const pass: ScoringPass = { scored: 0, kept: 0, lowScore: 0, pendingLeft: queue.length, error: null }
  const nowIso = now.toISOString()

  for (let start = 0; start < queue.length; start += BATCH_SIZE) {
    if (signal?.aborted) break
    const batch = queue.slice(start, start + BATCH_SIZE)
    onProgress?.({ scored: pass.scored, total: queue.length })
    await pace()
    if (signal?.aborted) break
    const result = await score(toScoreItems(batch))
    if (signal?.aborted && result.kind !== 'ok') break
    if (result.kind === 'error') {
      pass.error = result.error
      break
    }

    const postingUsage = result.usage ? apportionUsage(result.usage, batch.length) : undefined
    if (result.usage) {
      pass.usage = pass.usage ? addTokenUsage(pass.usage, result.usage) : result.usage
      const batchBySite = splitUsageBySite(
        result.usage,
        batch.map((item) => item.site),
      )
      pass.usageBySite = pass.usageBySite ? mergeUsageMaps(pass.usageBySite, batchBySite) : batchBySite
    }

    const kept: StoredPosting[] = []
    const dropped: DiscardRecord[] = []
    let lowScoreCount = 0
    for (const { index, score: value, reason } of result.scores) {
      const pending = batch[index] as PendingPosting
      if (value >= minScore) {
        kept.push(
          toStoredPosting(pending, {
            matchedKeywords: pending.matchedKeywords,
            score: value,
            scoreReason: reason,
            tokenUsage: postingUsage,
            collectedAt: nowIso,
            updatedAt: nowIso,
          }),
        )
      } else {
        lowScoreCount++
        dropped.push(...toDiscardRecords(pending, { gate: 'lowScore', score: value }, nowIso))
      }
    }
    await store.commitScored({ kept, dropped, resolved: batch })
    if (result.usage) await onUsage?.(result.usage, batch.length)
    pass.scored += batch.length
    pass.kept += kept.length
    pass.lowScore += lowScoreCount
    pass.pendingLeft -= batch.length
    onProgress?.({ scored: pass.scored, total: queue.length })
    onBatchCommitted?.()
    if (signal?.aborted) break
  }
  return pass
}

export function toScoringSummary(pass: ScoringPass, provider: AiProvider = 'gemini'): ScoringSummary {
  const { error, ...counts } = pass
  return { ...counts, error: error ? formatAiError(error, provider) : null }
}

export const emptyPass = (): ScoringPass => ({ scored: 0, kept: 0, lowScore: 0, pendingLeft: 0, error: null })
