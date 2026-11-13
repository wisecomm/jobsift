import type { CollectionSummary } from '../shared/types'

const KST_OFFSET_MS = 9 * 60 * 60 * 1000
const DAY_MS = 24 * 60 * 60 * 1000

// Dates are shown in Korean time whatever the machine's zone, so "D-day" means what the posting site means.
const kstDay = (ms: number) => Math.floor((ms + KST_OFFSET_MS) / DAY_MS)

export function formatDate(iso: string): string {
  return new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 10)
}

export interface DeadlineLabel {
  /** `null` for an open-ended posting. */
  date: string | null
  badge: string
  urgent: boolean
}

export function deadlineLabel(deadline: string | null, now: Date): DeadlineLabel {
  if (deadline === null) return { date: null, badge: '상시채용', urgent: false }
  const daysLeft = kstDay(Date.parse(deadline)) - kstDay(now.getTime())
  const date = formatDate(deadline)
  if (daysLeft < 0) return { date, badge: '마감', urgent: false }
  if (daysLeft === 0) return { date, badge: '오늘 마감', urgent: true }
  return { date, badge: `D-${daysLeft}`, urgent: daysLeft <= 3 }
}

const place = (location: string) => location.replaceAll('>', ' ')

export function locationSummary(locations: readonly string[]): string {
  if (locations.length === 0) return '지역 정보 없음'
  const shown = locations.slice(0, 2).map(place).join(', ')
  return locations.length > 2 ? `${shown} 외 ${locations.length - 2}곳` : shown
}

export function summaryLine(s: CollectionSummary): string {
  const g = s.discardedByGate
  return (
    `이번 수집: 확인 ${s.scanned}건 · 저장 ${s.saved}건 · 제외 ${s.discarded}건 ` +
    `(키워드 불일치 ${g.keywordMismatch}, 지역 ${g.location}, 경력 ${g.career}, 제외어 ${g.excludeKeyword}, 마감 ${g.expired}) · 마감 처리 ${s.expiredMarked}건`
  )
}

/** Plain-language notes for keywords whose run did not finish normally. */
export function stopNotices(s: CollectionSummary): string[] {
  return Object.entries(s.stopReasons).flatMap(([keyword, reason]) => {
    if (reason === 'page-cap') return [`"${keyword}": 페이지 수 상한에서 멈춰 오래된 공고를 다 보지 못했을 수 있습니다.`]
    if (reason === 'error') return [`"${keyword}": 수집 중 오류가 나서 중단했습니다. ${s.errors[keyword] ?? ''}`.trim()]
    return []
  })
}
