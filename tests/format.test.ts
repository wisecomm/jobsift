import { describe, expect, it } from 'vitest'
import { careerLabel } from '../src/shared/career'
import { deadlineLabel, locationSummary, stopNotices } from '../src/page/format'
import { SAMPLE_DESCRIPTIONS } from '../src/page/sampleDescriptions'
import type { CollectionSummary } from '../src/shared/types'

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
    scanned: 0, saved: 0, queued: 0, scoring: null, discarded: 0, expiredMarked: 0, errors: {}, stopReasons: {},
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
