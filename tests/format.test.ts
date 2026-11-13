import { describe, expect, it } from 'vitest'
import { careerLabel } from '../src/shared/career'
import { deadlineLabel, locationSummary, reportLines, runStatusLine, scoringLine, stopNotices, summaryLine } from '../src/page/format'
import { SAMPLE_DESCRIPTIONS } from '../src/page/sampleDescriptions'
import type { CollectionReport, CollectionSummary } from '../src/shared/types'

describe('careerLabel', () => {
  it('names every kind', () => {
    expect(careerLabel({ kind: 'new' })).toBe('신입')
    expect(careerLabel({ kind: 'any' })).toBe('경력무관')
    expect(careerLabel({ kind: 'experienced', minYears: 3 })).toBe('경력 3년↑')
    expect(careerLabel({ kind: 'experienced', minYears: null })).toBe('경력')
    expect(careerLabel({ kind: 'newOrExperienced', minYears: 2 })).toBe('신입·경력 2년↑')
    expect(careerLabel({ kind: 'newOrExperienced', minYears: null })).toBe('신입·경력')
    expect(careerLabel({ kind: 'unknown' })).toBe('경력 정보 없음')
  })
})

describe('deadlineLabel', () => {
  const now = new Date('2026-11-13T05:00:00+09:00')

  it('counts days left in Korean calendar days', () => {
    expect(deadlineLabel('2026-11-25T23:00:00+09:00', now)).toEqual({ date: '2026-11-25', badge: 'D-12', urgent: false })
    expect(deadlineLabel('2026-11-14T00:30:00+09:00', now)).toMatchObject({ badge: 'D-1', urgent: true })
  })

  it('says today for a deadline later the same day, even near midnight', () => {
    expect(deadlineLabel('2026-11-13T23:59:00+09:00', now)).toEqual({ date: '2026-11-13', badge: '오늘 마감', urgent: true })
    expect(deadlineLabel('2026-11-13T23:59:00+09:00', new Date('2026-11-13T00:10:00+09:00')).badge).toBe('오늘 마감')
  })

  it('shows an open-ended posting as always hiring', () => {
    expect(deadlineLabel(null, now)).toEqual({ date: null, badge: '상시채용', urgent: false })
  })

  it('marks a past deadline as closed', () => {
    expect(deadlineLabel('2026-11-10T12:00:00+09:00', now).badge).toBe('마감')
  })
})

describe('locationSummary', () => {
  it('shows one, two, and the first two plus a count', () => {
    expect(locationSummary(['서울>강남구'])).toBe('서울 강남구')
    expect(locationSummary(['서울>강남구', '경기>성남시'])).toBe('서울 강남구, 경기 성남시')
    const twelve = Array.from({ length: 12 }, (_, i) => `지역${i}`)
    expect(locationSummary(twelve)).toBe('지역0, 지역1 외 10곳')
    expect(locationSummary([])).toBe('지역 정보 없음')
  })
})

describe('stopNotices', () => {
  const summary = (over: Partial<CollectionSummary>): CollectionSummary => ({
    scanned: 0, saved: 0, queued: 0, aiOn: false, discarded: 0, expiredMarked: 0, errors: {}, stopReasons: {},
    discardedByGate: { expired: 0, excludeKeyword: 0, keywordMismatch: 0, location: 0, career: 0, lowScore: 0 },
    ...over,
  })

  it('reports only page-cap and error stops', () => {
    const notices = stopNotices(summary({ stopReasons: { 전산: 'page-cap', 회계: 'error', 총무: 'known', 인사: 'cutoff' }, errors: { 회계: '요청 실패 (500)' } }))
    expect(notices).toHaveLength(2)
    expect(notices[0]).toContain('전산')
    expect(notices[1]).toContain('요청 실패 (500)')
  })
})

describe('SAMPLE_DESCRIPTIONS', () => {
  it('offers the four labelled samples', () => {
    expect(SAMPLE_DESCRIPTIONS.map((s) => s.label)).toEqual(['공공기관 전산직', '사무·행정', '생산·기술직', '경력 개발자'])
  })
})

describe('collection and scoring lines', () => {
  const base: CollectionSummary = {
    scanned: 25, saved: 0, queued: 25, aiOn: false, discarded: 0, expiredMarked: 0, errors: {}, stopReasons: {},
    discardedByGate: { expired: 0, excludeKeyword: 0, keywordMismatch: 0, location: 0, career: 0, lowScore: 0 },
  }

  it('says saved in rules-only mode and queued in AI mode', () => {
    expect(summaryLine({ ...base, saved: 3, queued: 0 })).toContain('저장 3건')
    expect(summaryLine({ ...base, aiOn: true })).toContain('채점 대기열에 25건 추가')
  })

  it('reports scored, kept, low-score and pending counts', () => {
    expect(scoringLine({ scored: 20, kept: 9, lowScore: 11, pendingLeft: 5, error: null })).toBe('AI 채점: 20건 채점 · 저장 9건 · 점수 미달 11건 · 채점 대기 5건')
  })
})

describe('multi-site report', () => {
  const summary = (scanned: number, saved: number): CollectionSummary => ({
    scanned, saved, queued: 0, aiOn: false, discarded: 0, expiredMarked: 0, errors: {}, stopReasons: {},
    discardedByGate: { expired: 0, excludeKeyword: 0, keywordMismatch: 0, location: 0, career: 0, lowScore: 0 },
  })
  const name = (site: string) => ({ a: '가', b: '나' })[site] ?? site
  const run = (site: string, s: CollectionSummary) => ({ site, at: '2026-11-13T10:00:00Z', result: { kind: 'ok' as const, summary: s } })

  it('shows a single site as before, with no per-site lines', () => {
    const lines = reportLines({ runs: [run('a', summary(5, 2))], scoring: null }, name)
    expect(lines.total).toContain('확인 5건')
    expect(lines.perSite).toEqual([])
  })

  it('adds the sites up and names each site once more than one ran', () => {
    const report: CollectionReport = { runs: [run('a', summary(5, 2)), run('b', summary(7, 3))], scoring: null }
    const lines = reportLines(report, name)
    expect(lines.total).toContain('확인 12건')
    expect(lines.total).toContain('저장 5건')
    expect(lines.perSite.map((l) => [l.site, l.text.startsWith('확인')])).toEqual([['a', true], ['b', true]])
  })

  it('names the failed site in a notice and still totals the rest', () => {
    const report: CollectionReport = { runs: [run('a', summary(5, 2)), { site: 'b', at: 'x', result: { kind: 'error', message: '끊김' } }], scoring: null }
    const lines = reportLines(report, name)
    expect(lines.total).toContain('확인 5건')
    expect(lines.notices).toEqual(['나: 수집하지 못했습니다. 끊김'])
  })

  it('describes the last run on a site row in Korean time', () => {
    expect(runStatusLine(undefined)).toBe('아직 수집한 적이 없습니다.')
    expect(runStatusLine(run('a', summary(5, 2)))).toMatch(/^2026-11-13 19:00 · 확인 5건 · 저장 2건/)
    expect(runStatusLine({ site: 'a', at: '2026-11-13T10:00:00Z', result: { kind: 'error', message: '끊김' } })).toBe('2026-11-13 19:00 · 수집하지 못했습니다. 끊김')
  })
})
