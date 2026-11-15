import type { SiteAdapter } from '../adapter/schema'
import { DAY_MS } from '../shared/date'
import type { CollectionSummary, CollectState, JobPosting, PendingPosting, RejectGate, SearchCriteria, StoredPosting } from '../shared/types'
import type { Store } from '../storage/store'
import { collect, type CollectProgress } from './collect'
import { addSource, dedupKey } from './dedup'
import { evaluate } from './evaluate'
import { toDiscardRecords, toPendingPosting, toStoredPosting } from './postingRecords'

const DEADLINE_LESS_DISCARD_DAYS = 60
const INITIAL_LOOKBACK_DAYS = 7

export interface RunDeps {
  fetchHtml: (url: string) => Promise<string>
  now: Date
  sleep?: (ms: number) => Promise<void>
  /** AI on: the keyword gate is off and passes wait in the queue for scoring. Scoring itself belongs to runAllSites. */
  aiOn: boolean
  /** Per-keyword scan cap (in postings). */
  maxItems?: number
  /** Optional subset of `criteria.keywords` to collect. */
  keywords?: readonly string[]
  /** When true, resumes only keywords that previously stopped at `page-cap`. */
  continueFromCap?: boolean
  signal?: AbortSignal
  onProgress?: (progress: CollectProgress) => void
}

export const emptyGateCounts = (): Record<RejectGate, number> => ({
  expired: 0,
  keywordMismatch: 0,
  location: 0,
  career: 0,
  employmentType: 0,
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

async function prepareSite(store: Store, site: string, keywords: readonly string[], now: Date) {
  const expiredMarked = await store.markExpired(site, now)
  await pruneDiscards(store, site, now)

  const knownIds = await store.knownIds(site)
  const cutoffs = new Map<string, Date>()
  const neverCollected = new Set<string>()
  const statesByKeyword = new Map<string, CollectState>()
  for (const keyword of keywords) {
    const state = await store.getCollectState(site, keyword)
    if (state) {
      statesByKeyword.set(keyword, state)
      cutoffs.set(keyword, new Date(state.lastCollectedAt))
    } else {
      neverCollected.add(keyword)
    }
  }

  return { expiredMarked, knownIds, cutoffs, neverCollected, statesByKeyword }
}

async function tryMergeInBucket<T extends StoredPosting | PendingPosting>(
  bucket: Map<string, T>,
  save: (record: T) => Promise<void>,
  key: string,
  posting: JobPosting,
  matchedKeywords: readonly string[],
): Promise<boolean> {
  const match = bucket.get(key)
  if (!match || match.site === posting.site) return false
  const merged = addSource(match, posting, matchedKeywords)
  if (merged) {
    await save(merged)
    bucket.set(key, merged)
  }
  return true
}

export async function runCollection(
  adapter: SiteAdapter,
  criteria: SearchCriteria,
  store: Store,
  { fetchHtml, now, sleep, aiOn, maxItems, keywords, continueFromCap, signal, onProgress }: RunDeps,
): Promise<CollectionSummary> {
  const site = adapter.id
  const nowIso = now.toISOString()

  const requestedKeywords = keywords ? criteria.keywords.filter((k) => keywords.includes(k)) : criteria.keywords

  // 1. 사이트 사전 정리 및 수집 기준 로드
  const { expiredMarked, knownIds, cutoffs, neverCollected, statesByKeyword } = await prepareSite(store, site, requestedKeywords, now)
  const defaultCutoff = new Date(now.getTime() - INITIAL_LOOKBACK_DAYS * DAY_MS)

  const targetKeywords = continueFromCap
    ? requestedKeywords.filter((k) => statesByKeyword.get(k)?.resume !== undefined)
    : requestedKeywords

  // 2. 키워드별 페이지 수집 및 파싱
  const { postings, stopReasons, nextPages, errors } =
    targetKeywords.length === 0
      ? { postings: [] as JobPosting[], stopReasons: {}, nextPages: {} as Record<string, number>, errors: {} }
      : await collect(adapter, { ...criteria, keywords: targetKeywords }, {
          fetchHtml,
          now,
          knownIds,
          cutoffFor: (keyword) => {
            if (!continueFromCap) return cutoffs.get(keyword) ?? defaultCutoff
            const resumeCutoff = statesByKeyword.get(keyword)?.resume?.cutoff
            return resumeCutoff ? new Date(resumeCutoff) : defaultCutoff
          },
          scanPastKnown: (keyword) => (continueFromCap ? true : neverCollected.has(keyword)),
          startPageFor: continueFromCap ? (keyword) => statesByKeyword.get(keyword)?.resume?.nextPage : undefined,
          skipKnownInCap: continueFromCap ? () => true : undefined,
          sleep,
          maxItems,
          signal,
          onProgress,
        })

  // 3. 규칙 분류, 교차 사이트 중복 병합, 저장소 분기
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
    ...(maxItems !== undefined ? { maxItems } : {}),
  }

  for (const posting of postings) {
    const result = evaluate(posting, criteria, now, { requireKeywordMatch: !aiOn })
    if (result.kind === 'reject') {
      await store.putDiscard(toDiscardRecords(posting, result.reason, nowIso)[0]!)
      summary.discarded++
      summary.discardedByGate[result.reason.gate]++
      continue
    }

    const key = dedupKey(posting)
    const merged =
      (await tryMergeInBucket(storedByKey, store.putPosting, key, posting, result.matchedKeywords)) ||
      (await tryMergeInBucket(pendingByKey, store.putPending, key, posting, result.matchedKeywords))
    if (merged) continue

    if (aiOn) {
      const item = toPendingPosting(posting, result.matchedKeywords, nowIso)
      await store.putPending(item)
      pendingByKey.set(key, item)
      summary.queued++
    } else {
      const item = toStoredPosting(posting, {
        matchedKeywords: result.matchedKeywords,
        score: null,
        scoreReason: null,
        collectedAt: nowIso,
        updatedAt: nowIso,
      })
      if (await store.addPosting(item)) {
        storedByKey.set(key, item)
        summary.saved++
      }
    }
  }

  // 4. 정상 완료된 키워드의 수집 시각 및 이어하기 커서 갱신
  for (const keyword of targetKeywords) {
    if (stopReasons[keyword] === 'error') continue
    const prev = statesByKeyword.get(keyword)
    const lastCollectedAt = continueFromCap ? (prev?.lastCollectedAt ?? nowIso) : nowIso
    if (stopReasons[keyword] === 'page-cap') {
      const resumeCutoff = continueFromCap
        ? (prev?.resume?.cutoff ?? defaultCutoff.toISOString())
        : (prev?.lastCollectedAt ?? defaultCutoff.toISOString())
      const nextPage = nextPages[keyword] ?? adapter.search.firstPage
      await store.putCollectState({ site, keyword, lastCollectedAt, resume: { nextPage, cutoff: resumeCutoff } })
    } else {
      await store.putCollectState({ site, keyword, lastCollectedAt })
    }
  }

  return summary
}
