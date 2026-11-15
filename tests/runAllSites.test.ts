import { describe, expect, it } from 'vitest'
import secondJson from './fixtures/second-adapter.json'
import { parseAdapter } from '../src/adapter/schema'
import { applyCriteriaChange } from '../src/engine/applyCriteriaChange'
import { runAllSites } from '../src/engine/runAllSites'
import type { ScoreFn, ScoreItem } from '../src/ai/types'
import type { PendingPosting, StoredPosting } from '../src/shared/types'
import { adapter as first, criteria, fakePage, freshStore, posting, type FakeItem } from './helpers'

const second = parseAdapter(secondJson)
const NOW = new Date('2026-11-13T20:00:00+09:00')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()
const items = (ids: number[], companyPrefix = '회사'): FakeItem[] =>
  ids.map((n) => ({ id: String(n), createdAt: hoursAgo(n), company: `${companyPrefix} ${n}` }))

/** Serves each host its own pages and records which hosts were asked. */
function web(pages: Record<string, FakeItem[]>, failingHosts: string[] = []) {
  const hosts: string[] = []
  return {
    hosts,
    deps: {
      now: NOW,
      sleep: async () => {},
      fetchHtml: async (url: string) => {
        const { host } = new URL(url)
        hosts.push(host)
        if (failingHosts.includes(host)) throw new Error(`${host} 연결 실패`)
        return fakePage(pages[host] ?? [], 1)
      },
    },
  }
}

const JK = 'www.jobkorea.co.kr'
const SECOND = 'second.test'

const stored = (site: string, id: string, overrides: Partial<StoredPosting> = {}): StoredPosting => ({
  ...posting({ site, externalId: id }),
  status: 'new',
  memo: '',
  matchedKeywords: ['전산'],
  score: null,
  scoreReason: null,
  collectedAt: '2026-11-01T00:00:00Z',
  updatedAt: '2026-11-01T00:00:00Z',
  ...overrides,
})

const waiting = (site: string, id: number): PendingPosting => ({
  ...posting({ site, externalId: String(id), title: `공고 ${id}` }),
  matchedKeywords: ['전산'],
  queuedAt: '2026-11-13T00:00:00Z',
})

describe('runAllSites', () => {
  it('fetches only the sites it is given, and keeps ids per site', async () => {
    const store = await freshStore()
    const w = web({ [JK]: items([1, 2], '잡코'), [SECOND]: items([1, 3], '세컨드') })

    const onlySecond = await runAllSites([second], criteria(), store, w.deps)
    expect(new Set(w.hosts)).toEqual(new Set([SECOND]))
    expect(onlySecond.runs.map((r) => r.site)).toEqual(['second'])

    const both = await runAllSites([first, second], criteria(), store, w.deps)
    expect(both.runs.map((r) => r.site)).toEqual(['jobkorea', 'second'])
    expect((await store.listPostings('jobkorea')).map((p) => p.externalId).sort()).toEqual(['1', '2'])
    expect((await store.listPostings('second')).map((p) => p.externalId).sort()).toEqual(['1', '3'])
  })

  it('records an ok summary per site with the run time', async () => {
    const store = await freshStore()
    const report = await runAllSites([first, second], criteria(), store, web({ [JK]: items([1], '잡코'), [SECOND]: items([1, 2], '세컨드') }).deps)
    expect(report.scoring).toBeNull()
    expect(report.runs.map((r) => [r.site, r.at, r.result.kind === 'ok' ? r.result.summary.saved : null])).toEqual([
      ['jobkorea', NOW.toISOString(), 1],
      ['second', NOW.toISOString(), 2],
    ])
  })

  it('reports a site that throws and still runs the others', async () => {
    const store = await freshStore()
    const w = web({ [SECOND]: items([1]) })
    const broken = { ...store, markExpired: (site: string, now: Date) => (site === 'jobkorea' ? Promise.reject(new Error('저장소 오류')) : store.markExpired(site, now)) }

    const report = await runAllSites([first, second], criteria(), broken, w.deps)

    expect(report.runs[0]).toMatchObject({ site: 'jobkorea', result: { kind: 'error', message: '저장소 오류' } })
    expect(report.runs[1]).toMatchObject({ site: 'second', result: { kind: 'ok' } })
    expect((await store.listPostings('second')).map((p) => p.externalId)).toEqual(['1'])
  })

  it('keeps a keyword failure inside its own site summary', async () => {
    const store = await freshStore()
    const w = web({ [SECOND]: items([1]) }, [JK])
    const report = await runAllSites([first, second], criteria(), store, w.deps)
    expect(report.runs.map((r) => r.result.kind)).toEqual(['ok', 'ok'])
    const jobkorea = report.runs[0]!.result
    expect(jobkorea.kind === 'ok' && jobkorea.summary.errors).toEqual({ 전산: `${JK} 연결 실패` })
  })
})

describe('runAllSites with AI on', () => {
  /** Score = the number in the title. */
  function ai(log: string[], failOnCall = 0, minScore = 0) {
    let calls = 0
    const score: ScoreFn = async (batch: ScoreItem[]) => {
      calls++
      log.push(`score#${calls}(${batch.length})`)
      if (calls === failOnCall) return { kind: 'error', error: { kind: 'rateLimited' } }
      return { kind: 'ok', scores: batch.map((i) => ({ index: i.index, score: Number(/\d+/.exec(i.title)?.[0]), reason: '이유' })) }
    }
    return { score, minScore, now: NOW, pace: async () => void log.push('pace') }
  }

  it('scores one pass over every site, before and after fetching', async () => {
    const store = await freshStore()
    await store.putPending(waiting('jobkorea', 90))
    await store.putPending(waiting('second', 91))
    const log: string[] = []
    const w = web({ [JK]: items([1, 2]), [SECOND]: items([3]) })
    const deps = { ...w.deps, fetchHtml: async (url: string) => (log.push('fetch'), w.deps.fetchHtml(url)), scoring: ai(log) }

    const report = await runAllSites([first, second], criteria(), store, deps)

    expect(log).toEqual(['pace', 'score#1(2)', 'fetch', 'fetch', 'pace', 'score#2(3)'])
    expect(report.scoring).toMatchObject({ scored: 5, kept: 5, pendingLeft: 0, error: null })
    expect(await store.listPending()).toEqual([])
  })

  it('attaches per-site tokenUsage to each ok site summary when AI scoring reports usage', async () => {
    const store = await freshStore()
    const w = web({ [JK]: items([1, 2]), [SECOND]: items([3]) })
    const scoring = {
      minScore: 0,
      now: NOW,
      pace: async () => {},
      score: async (batch: ScoreItem[]) => ({
        kind: 'ok' as const,
        scores: batch.map((i) => ({ index: i.index, score: 80, reason: '적합' })),
        usage: { inputTokens: 300, outputTokens: 90, thoughtTokens: 60, cachedTokens: 0, totalTokens: 450 },
      }),
    }

    const report = await runAllSites([first, second], criteria(), store, { ...w.deps, scoring })
    const jkSummary = report.runs[0]?.result.kind === 'ok' ? report.runs[0].result.summary : null
    const secSummary = report.runs[1]?.result.kind === 'ok' ? report.runs[1].result.summary : null
    expect(jkSummary?.tokenUsage).toEqual({ inputTokens: 200, outputTokens: 60, thoughtTokens: 40, cachedTokens: 0, totalTokens: 300 })
    expect(secSummary?.tokenUsage).toEqual({ inputTokens: 100, outputTokens: 30, thoughtTokens: 20, cachedTokens: 0, totalTokens: 150 })
  })

  it('on a failed first pass, still collects every site and leaves all of it queued', async () => {
    const store = await freshStore()
    await store.putPending(waiting('jobkorea', 90))
    const log: string[] = []
    const w = web({ [JK]: items([1]), [SECOND]: items([2]) })

    const report = await runAllSites([first, second], criteria(), store, { ...w.deps, scoring: ai(log, 1) })

    expect(log).toEqual(['pace', 'score#1(1)'])
    expect(report.runs.map((r) => r.result.kind)).toEqual(['ok', 'ok'])
    expect(report.scoring).toMatchObject({ scored: 0, pendingLeft: 3 })
    expect(report.scoring?.error).toMatch(/한도/)
  })
})

describe('postings of disabled and removed sites', () => {
  it('stay listed with their status when only the other site is collected', async () => {
    const store = await freshStore()
    await store.putPosting(stored('jobkorea', 'a', { status: 'saved', memo: '메모' }))
    await runAllSites([second], criteria(), store, web({ [SECOND]: items([1]) }).deps)

    const all = await store.listPostings()
    expect(all.map((p) => `${p.site}:${p.externalId}`).sort()).toEqual(['jobkorea:a', 'second:1'])
    expect(all.find((p) => p.site === 'jobkorea')).toMatchObject({ status: 'saved', memo: '메모' })
  })
})

describe('applyCriteriaChange across sites', () => {
  it('re-applies the rules to the postings of every site', async () => {
    const store = await freshStore()
    const busan = { locations: ['부산>해운대구'] }
    await store.putPosting(stored('jobkorea', 'a', busan))
    await store.putPosting(stored('second', 'b', busan))
    await store.putPosting(stored('second', 'c'))
    await store.putPending({ ...waiting('second', 4), locations: ['부산>해운대구'] })

    const { removed } = await applyCriteriaChange(store, criteria({ locations: ['서울'] }), { aiOn: false }, NOW)

    expect(removed).toBe(3)
    expect((await store.listPostings()).map((p) => `${p.site}:${p.externalId}`)).toEqual(['second:c'])
    expect((await store.listDiscards('jobkorea')).map((d) => d.externalId)).toEqual(['a'])
    expect((await store.listDiscards('second')).map((d) => d.externalId).sort()).toEqual(['4', 'b'])
  })

  it('writes discard records for all sites on a grouped posting', async () => {
    const store = await freshStore()
    await store.putPosting(
      stored('jobkorea', 'a', {
        locations: ['부산>해운대구'],
        alsoOn: [{ site: 'second', externalId: 's1', url: 'https://second.example.test/s1' }],
      }),
    )

    const { removed } = await applyCriteriaChange(store, criteria({ locations: ['서울'] }), { aiOn: false }, NOW)

    expect(removed).toBe(1)
    expect(await store.listPostings()).toEqual([])
    expect((await store.listDiscards('jobkorea')).map((d) => d.externalId)).toEqual(['a'])
    expect((await store.listDiscards('second')).map((d) => d.externalId)).toEqual(['s1'])
  })
})

describe('cross-site duplicate grouping (Q31)', () => {
  it('merges matching postings in rules mode without duplicating cards or losing status', async () => {
    const store = await freshStore()
    const jkItems: FakeItem[] = [{ id: '10', createdAt: hoursAgo(1), title: '전산 백엔드 개발', company: '(주)테스트' }]
    const secondItems: FakeItem[] = [{ id: '99', createdAt: hoursAgo(2), title: '전산 백엔드 개발', company: '주식회사 테스트' }]

    await runAllSites([first, second], criteria(), store, web({ [JK]: jkItems, [SECOND]: secondItems }).deps)

    const postings = await store.listPostings()
    expect(postings).toHaveLength(1)
    expect(postings[0]).toMatchObject({
      site: 'jobkorea',
      externalId: '10',
      alsoOn: [{ site: 'second', externalId: '99', url: 'https://second.test/jobs/99' }],
    })
    expect((await store.knownIds('second')).has('99')).toBe(true)

    await store.updatePosting({ site: 'jobkorea', externalId: '10' }, { status: 'saved', memo: '메모 유지' }, NOW)
    await runAllSites([first, second], criteria(), store, web({ [JK]: jkItems, [SECOND]: secondItems }).deps)
    expect(await store.listPostings()).toHaveLength(1)
    expect((await store.listPostings())[0]).toMatchObject({ status: 'saved', memo: '메모 유지' })
  })

  it('keeps postings in different locations separate', async () => {
    const store = await freshStore()
    const jkItems: FakeItem[] = [{ id: '10', createdAt: hoursAgo(1), title: '전산 백엔드 개발', company: '테스트', areas: ['I010'] }]
    const secondItems: FakeItem[] = [{ id: '99', createdAt: hoursAgo(2), title: '전산 백엔드 개발', company: '테스트', areas: ['B010'] }]

    await runAllSites([first, second], criteria({ locations: ['서울', '경기'] }), store, web({ [JK]: jkItems, [SECOND]: secondItems }).deps)

    expect(await store.listPostings()).toHaveLength(2)
  })

  it('scores duplicate pending posting once in AI mode and discards all sites when below minScore', async () => {
    const store = await freshStore()
    const jkItems: FakeItem[] = [{ id: '10', createdAt: hoursAgo(1), title: '50 점 공고', company: '테스트' }]
    const secondItems: FakeItem[] = [{ id: '99', createdAt: hoursAgo(2), title: '50 점 공고', company: '테스트' }]
    const batches: number[] = []
    const scoring = {
      minScore: 60,
      now: NOW,
      pace: async () => {},
      score: async (batch: ScoreItem[]) => {
        batches.push(batch.length)
        return { kind: 'ok' as const, scores: batch.map((i) => ({ index: i.index, score: 50, reason: '낮음' })) }
      },
    }

    const report = await runAllSites([first, second], criteria(), store, { ...web({ [JK]: jkItems, [SECOND]: secondItems }).deps, scoring })

    expect(batches).toEqual([1])
    expect(report.scoring).toMatchObject({ scored: 1, kept: 0, lowScore: 1 })
    expect(await store.listPostings()).toEqual([])
    expect((await store.listDiscards('jobkorea')).map((d) => d.externalId)).toEqual(['10'])
    expect((await store.listDiscards('second')).map((d) => d.externalId)).toEqual(['99'])
  })

  it('preserves alsoOn when AI keeps a grouped pending posting', async () => {
    const store = await freshStore()
    const jkItems: FakeItem[] = [{ id: '10', createdAt: hoursAgo(1), title: '90 점 공고', company: '테스트' }]
    const secondItems: FakeItem[] = [{ id: '99', createdAt: hoursAgo(2), title: '90 점 공고', company: '테스트' }]
    const scoring = {
      minScore: 60,
      now: NOW,
      pace: async () => {},
      score: async (batch: ScoreItem[]) => ({
        kind: 'ok' as const,
        scores: batch.map((i) => ({ index: i.index, score: 90, reason: '적합' })),
      }),
    }

    await runAllSites([first, second], criteria(), store, { ...web({ [JK]: jkItems, [SECOND]: secondItems }).deps, scoring })

    const postings = await store.listPostings()
    expect(postings).toHaveLength(1)
    expect(postings[0]?.alsoOn).toEqual([{ site: 'second', externalId: '99', url: 'https://second.test/jobs/99' }])
  })
})
