import { describe, expect, it } from 'vitest'
import secondJson from './fixtures/second-adapter.json'
import { parseAdapter } from '../src/adapter/schema'
import { applyCriteriaChange } from '../src/engine/applyCriteriaChange'
import { RULE_GATES } from '../src/engine/evaluate'
import { toDiscardRecords, toPendingPosting, toStoredPosting, type PostingCandidate } from '../src/engine/postingRecords'
import { runAllSites } from '../src/engine/runAllSites'
import { stopNotices } from '../src/page/format'
import type { ScoreItem } from '../src/ai/types'
import { adapter as jobkorea, criteria, fakePage, freshStore, posting, type FakeItem } from './helpers'

const second = parseAdapter(secondJson)
const NOW = new Date('2026-11-13T20:00:00+09:00')
const hoursAgo = (h: number) => new Date(NOW.getTime() - h * 3600_000).toISOString()

describe('단순화된 분류/저장 워크플로우 검증', () => {
  it('RULE_GATES가 4개 조건 그룹(deadline, keyword, location, career) 순서대로 구성된다', () => {
    expect(RULE_GATES.map((r) => [r.group, r.gate])).toEqual([
      ['deadline', 'expired'],
      ['keyword', 'keywordMismatch'],
      ['location', 'location'],
      ['career', 'career'],
    ])
  })

  it('postingRecords 변환 시 이전 라이프사이클 필드가 남지 않고 출처별 폐기 레코드가 생성된다', () => {
    const base: PostingCandidate = {
      ...posting({ externalId: '10' }),
      alsoOn: [{ site: 'second', externalId: '20', url: 'https://second.test/jobs/20' }],
    }

    const pending = toPendingPosting(base, ['전산'], '2026-11-13T00:00:00Z')
    expect(pending).toMatchObject({ externalId: '10', matchedKeywords: ['전산'], queuedAt: '2026-11-13T00:00:00Z' })

    const stored = toStoredPosting(pending, {
      matchedKeywords: pending.matchedKeywords,
      score: 88,
      scoreReason: '적합',
      collectedAt: pending.queuedAt,
      updatedAt: NOW.toISOString(),
    })
    expect('queuedAt' in stored).toBe(false)
    expect(stored).toMatchObject({ status: 'new', memo: '', score: 88, alsoOn: base.alsoOn })

    const backToPending = toPendingPosting(stored, ['전산'], stored.collectedAt)
    expect('status' in backToPending).toBe(false)
    expect('score' in backToPending).toBe(false)
    expect(backToPending).toMatchObject({ queuedAt: '2026-11-13T00:00:00Z', alsoOn: base.alsoOn })

    const discards = toDiscardRecords(stored, { gate: 'lowScore', score: 40 }, NOW.toISOString())
    expect(discards).toEqual([
      { site: 'jobkorea', externalId: '10', reason: { gate: 'lowScore', score: 40 }, discardedAt: NOW.toISOString(), deadline: null },
      { site: 'second', externalId: '20', reason: { gate: 'lowScore', score: 40 }, discardedAt: NOW.toISOString(), deadline: null },
    ])
  })

  it('수집(규칙+중복병합) -> 조건변경(AI 전환) -> AI 채점까지 전체 흐름이 일관되게 동작한다', async () => {
    const store = await freshStore()
    const jkItems: FakeItem[] = [
      { id: '1', createdAt: hoursAgo(1), title: '전산 백엔드', company: '(주)알파' },
      { id: '2', createdAt: hoursAgo(2), title: '전산 운영', company: '베타' },
      { id: '3', createdAt: hoursAgo(3), title: '전산 부산', company: '감마', areas: ['B010'] }, // location
    ]
    const secondItems: FakeItem[] = [
      { id: '101', createdAt: hoursAgo(1), title: '전산 백엔드', company: '주식회사 알파' }, // cross-site duplicate of #1
      { id: '102', createdAt: hoursAgo(2), title: '총무 담당', company: '델타' }, // keywordMismatch when AI OFF
    ]

    const fetchByHost = (pages: Record<string, FakeItem[]>) => async (url: string) => {
      const { host } = new URL(url)
      return fakePage(pages[host] ?? [], 1)
    }

    // 1단계: AI OFF 수집 -> 규칙 필터 + 교차 사이트 중복 병합
    const rules = criteria({ keywords: ['전산'], locations: ['서울'] })
    const firstReport = await runAllSites([jobkorea, second], rules, store, {
      now: NOW,
      sleep: async () => {},
      fetchHtml: fetchByHost({ 'www.jobkorea.co.kr': jkItems, 'second.test': secondItems }),
    })

    expect(firstReport.scoring).toBeNull()
    const afterRules = await store.listPostings()
    expect(afterRules).toHaveLength(2)
    expect(afterRules.find((p) => p.externalId === '1')?.alsoOn).toEqual([
      { site: 'second', externalId: '101', url: 'https://second.test/jobs/101' },
    ])
    expect((await store.listDiscards('jobkorea')).map((d) => [d.externalId, d.reason.gate])).toEqual([['3', 'location']])
    expect((await store.listDiscards('second')).map((d) => [d.externalId, d.reason.gate])).toEqual([['102', 'keywordMismatch']])

    // 사용자가 #2를 저장 처리하면 이후 조건 변경에도 보호되어야 함
    await store.updatePosting({ site: 'jobkorea', externalId: '2' }, { status: 'saved', memo: '관심 공고' }, NOW)

    // 2단계: AI ON으로 조건 변경 -> 보호되지 않은 new(#1)만 pending으로 이동, saved(#2) 유지
    const change = await applyCriteriaChange(store, rules, { aiOn: true }, NOW)
    expect(change).toEqual({ removed: 0, queued: 1 })
    expect((await store.listPending()).map((p) => p.externalId)).toEqual(['1'])
    expect((await store.listPostings()).map((p) => [p.externalId, p.status, p.memo])).toEqual([['2', 'saved', '관심 공고']])

    // 3단계: AI ON 재수집 시 기존 discards가 비워졌으므로 second:102도 AI 평가 대기열로 유입되고 점수에 따라 저장/폐기됨
    const secondReport = await runAllSites([jobkorea, second], rules, store, {
      now: new Date(NOW.getTime() + 60_000),
      sleep: async () => {},
      fetchHtml: fetchByHost({ 'www.jobkorea.co.kr': jkItems, 'second.test': secondItems }),
      scoring: {
        minScore: 60,
        now: new Date(NOW.getTime() + 60_000),
        pace: async () => {},
        score: async (batch: ScoreItem[]) => ({
          kind: 'ok',
          scores: batch.map((item) => ({
            index: item.index,
            score: item.title.includes('총무') ? 25 : 85,
            reason: item.title.includes('총무') ? '직무 불일치' : '직무 적합',
          })),
        }),
      },
    })

    expect(secondReport.scoring).toMatchObject({ scored: 2, kept: 1, lowScore: 1, pendingLeft: 0, error: null })
    expect(await store.listPending()).toEqual([])
    const finalPostings = await store.listPostings()
    expect(finalPostings.map((p) => [p.externalId, p.status, p.score]).sort()).toEqual([
      ['1', 'new', 85],
      ['2', 'saved', null],
    ])
    expect((await store.listDiscards('second')).map((d) => [d.externalId, d.reason])).toEqual([
      ['102', { gate: 'lowScore', score: 25 }],
    ])
  })

  it('사이트별 최대 수집 개수(maxItemsFor)를 넘으면 중단하고 안내 메시지를 생성한다', async () => {
    const store = await freshStore()
    const items = Array.from({ length: 20 }, (_, i) => ({
      id: String(i + 1),
      createdAt: hoursAgo(i + 1),
      title: `전산 공고 ${i + 1}`,
    }))
    const report = await runAllSites([jobkorea], criteria({ keywords: ['전산'] }), store, {
      now: NOW,
      sleep: async () => {},
      maxItemsFor: () => 5,
      fetchHtml: async () => fakePage(items, 3),
    })

    const summary = report.runs[0]?.result.kind === 'ok' ? report.runs[0].result.summary : null
    expect(summary).toMatchObject({ scanned: 5, saved: 5, maxItems: 5, stopReasons: { 전산: 'page-cap' } })
    expect(stopNotices(summary!)).toEqual([
      '최대 수집 개수(5건)를 넘어 멈춰 마감 전 공고를 다 보지 못했을 수 있습니다.',
    ])
  })
})
