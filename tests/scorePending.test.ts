import { describe, expect, it } from 'vitest'
import type { ScoreFn, ScoreItem, ScoreResult } from '../src/ai/types'
import { scorePending, toScoringSummary } from '../src/engine/scorePending'
import type { PendingPosting } from '../src/shared/types'
import { freshStore, posting } from './helpers'

const NOW = new Date('2026-11-13T20:00:00+09:00')

const pending = (id: number): PendingPosting => ({
  ...posting({ externalId: String(id), title: `공고 ${id}`, company: `회사 ${id}`, deadline: '2099-01-01T00:00:00+09:00' }),
  matchedKeywords: ['전산'],
  queuedAt: `2026-11-13T00:00:${String(id % 60).padStart(2, '0')}Z`,
})

async function queued(count: number) {
  const store = await freshStore()
  for (let i = 1; i <= count; i++) await store.putPending(pending(i))
  return store
}

const scoreOf = (title: string) => Number(title.replace('공고 ', ''))

/** Scores a posting by its number, so tests choose outcomes through the ids. */
function scorer(log: string[], fail?: { onCall: number; error: ScoreResult }) {
  let calls = 0
  const score: ScoreFn = async (items: ScoreItem[]) => {
    calls++
    log.push(`score#${calls}(${items.length})`)
    if (fail && calls === fail.onCall) return fail.error
    return { kind: 'ok', scores: items.map((item) => ({ index: item.index, score: scoreOf(item.title), reason: `이유 ${item.title}` })) }
  }
  return score
}

const deps = (log: string[], score: ScoreFn, minScore = 60) => ({
  score,
  minScore,
  now: NOW,
  pace: async () => void log.push('pace'),
})

describe('scorePending', () => {
  it('keeps scores at or above minScore and discards the rest as identity-only records', async () => {
    const store = await queued(25)
    const log: string[] = []
    const pass = await scorePending(store, deps(log, scorer(log), 22))

    expect(pass).toMatchObject({ scored: 25, kept: 4, lowScore: 21, pendingLeft: 0, error: null })
    const kept = await store.listPostings('jobkorea')
    expect(kept.map((p) => [p.externalId, p.score, p.scoreReason, p.status]).sort()).toEqual([
      ['22', 22, '이유 공고 22', 'new'],
      ['23', 23, '이유 공고 23', 'new'],
      ['24', 24, '이유 공고 24', 'new'],
      ['25', 25, '이유 공고 25', 'new'],
    ])
    expect(kept[0]).toMatchObject({ title: expect.stringContaining('공고'), matchedKeywords: ['전산'], memo: '' })
    const discards = await store.listDiscards('jobkorea')
    expect(discards).toHaveLength(21)
    expect(discards.find((d) => d.externalId === '5')).toEqual({
      site: 'jobkorea',
      externalId: '5',
      reason: { gate: 'lowScore', score: 5 },
      discardedAt: NOW.toISOString(),
      deadline: '2099-01-01T00:00:00+09:00',
    })
    expect(Object.keys(discards[0] ?? {}).sort()).toEqual(['deadline', 'discardedAt', 'externalId', 'reason', 'site'])
    expect(await store.listPending('jobkorea')).toEqual([])
  })

  it('sends batches of ten and paces before every request', async () => {
    const store = await queued(25)
    const log: string[] = []
    await scorePending(store, deps(log, scorer(log)))
    expect(log).toEqual(['pace', 'score#1(10)', 'pace', 'score#2(10)', 'pace', 'score#3(5)'])
  })

  it('commits each batch as it finishes', async () => {
    const store = await queued(25)
    const log: string[] = []
    const inspecting: ScoreFn = async (items) => {
      const left = (await store.listPending('jobkorea')).length
      log.push(`pending before request: ${left}`)
      return scorer([], undefined)(items)
    }
    await scorePending(store, deps(log, inspecting))
    expect(log.filter((l) => l.startsWith('pending'))).toEqual(['pending before request: 25', 'pending before request: 15', 'pending before request: 5'])
  })

  it('stops at the first failed batch, keeps earlier batches, and leaves the rest pending', async () => {
    const store = await queued(25)
    const log: string[] = []
    const pass = await scorePending(store, deps(log, scorer(log, { onCall: 2, error: { kind: 'error', error: { kind: 'rateLimited' } } })))

    expect(pass).toMatchObject({ scored: 10, pendingLeft: 15, error: { kind: 'rateLimited' } })
    expect(log.filter((l) => l.startsWith('score'))).toEqual(['score#1(10)', 'score#2(10)'])
    expect((await store.listPending('jobkorea')).map((p) => Number(p.externalId)).sort((a, b) => a - b)).toEqual(Array.from({ length: 15 }, (_, i) => i + 11))
    expect(await store.listPostings('jobkorea')).toHaveLength(0)
    expect(await store.listDiscards('jobkorea')).toHaveLength(10)
    expect(toScoringSummary(pass).error).toMatch(/한도/)
  })

  it('resumes on the next call and finishes the rest', async () => {
    const store = await queued(25)
    const log: string[] = []
    await scorePending(store, deps(log, scorer(log, { onCall: 2, error: { kind: 'error', error: { kind: 'rateLimited' } } })))
    const second = await scorePending(store, deps(log, scorer(log)))

    expect(second).toMatchObject({ scored: 15, pendingLeft: 0, error: null })
    expect(await store.listPending('jobkorea')).toEqual([])
    expect((await store.listPostings('jobkorea')).length + (await store.listDiscards('jobkorea')).length).toBe(25)
  })

  it('does nothing and sends no request when the queue is empty', async () => {
    const store = await freshStore()
    const log: string[] = []
    expect(await scorePending(store, deps(log, scorer(log)))).toEqual({ scored: 0, kept: 0, lowScore: 0, pendingLeft: 0, error: null })
    expect(log).toEqual([])
  })

  it('saves apportioned token usage onto kept postings and accumulates exact batch totals via onUsage', async () => {
    const store = await freshStore()
    for (let i = 1; i <= 12; i++) await store.putPending(pending(i))
    const usageEvents: { count: number; totalTokens: number }[] = []
    const scoreWithUsage: ScoreFn = async (items) => ({
      kind: 'ok',
      scores: items.map((item) => ({ index: item.index, score: 80, reason: '적합' })),
      usage: { inputTokens: 100, outputTokens: 50, thoughtTokens: 50, cachedTokens: 0, totalTokens: 200 },
    })
    const pass = await scorePending(store, {
      ...deps([], scoreWithUsage, 60),
      onUsage: (usage, count) => void usageEvents.push({ count, totalTokens: usage.totalTokens }),
    })

    expect(pass.usage).toEqual({ inputTokens: 200, outputTokens: 100, thoughtTokens: 100, cachedTokens: 0, totalTokens: 400 })
    expect(pass.usageBySite).toEqual({ jobkorea: { inputTokens: 200, outputTokens: 100, thoughtTokens: 100, cachedTokens: 0, totalTokens: 400 } })
    expect(usageEvents).toEqual([
      { count: 10, totalTokens: 200 },
      { count: 2, totalTokens: 200 },
    ])
    const p1 = await store.getPosting({ site: 'jobkorea', externalId: '1' })
    const p12 = await store.getPosting({ site: 'jobkorea', externalId: '12' })
    expect(p1?.tokenUsage).toEqual({ inputTokens: 10, outputTokens: 5, thoughtTokens: 5, cachedTokens: 0, totalTokens: 20, batchSize: 10 })
    expect(p12?.tokenUsage).toEqual({ inputTokens: 50, outputTokens: 25, thoughtTokens: 25, cachedTokens: 0, totalTokens: 100, batchSize: 2 })
  })
})
