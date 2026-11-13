import { KST_OFFSET_MS, kstDay } from '../shared/date'
import type { CollectionReport, CollectionSummary, ScoringSummary, SiteRunStatus } from '../shared/types'

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

type Totals = Omit<CollectionSummary, 'stopReasons' | 'errors'>

function summaryBody(s: Totals): string {
  const g = s.discardedByGate
  const stored = s.aiOn ? `채점 대기열에 ${s.queued}건 추가` : `저장 ${s.saved}건`
  return (
    `확인 ${s.scanned}건 · ${stored} · 제외 ${s.discarded}건 ` +
    `(키워드 불일치 ${g.keywordMismatch}, 지역 ${g.location}, 경력 ${g.career}, 제외어 ${g.excludeKeyword}, 마감 ${g.expired}) · 마감 처리 ${s.expiredMarked}건`
  )
}

export const summaryLine = (s: Totals) => `이번 수집: ${summaryBody(s)}`

export function combineSummaries(summaries: readonly CollectionSummary[]): Totals {
  const total: Totals = {
    scanned: 0,
    saved: 0,
    queued: 0,
    aiOn: summaries.some((s) => s.aiOn),
    discarded: 0,
    discardedByGate: { expired: 0, excludeKeyword: 0, keywordMismatch: 0, location: 0, career: 0, lowScore: 0 },
    expiredMarked: 0,
  }
  for (const s of summaries) {
    total.scanned += s.scanned
    total.saved += s.saved
    total.queued += s.queued
    total.discarded += s.discarded
    total.expiredMarked += s.expiredMarked
    for (const gate of Object.keys(total.discardedByGate) as (keyof Totals['discardedByGate'])[]) total.discardedByGate[gate] += s.discardedByGate[gate]
  }
  return total
}

export function scoringLine(r: ScoringSummary): string {
  return `AI 채점: ${r.scored}건 채점 · 저장 ${r.kept}건 · 점수 미달 ${r.lowScore}건 · 채점 대기 ${r.pendingLeft}건`
}

/** Plain-language notes for keywords whose run did not finish normally. */
export function stopNotices(s: CollectionSummary): string[] {
  return Object.entries(s.stopReasons).flatMap(([keyword, reason]) => {
    if (reason === 'page-cap') return [`"${keyword}": 페이지 수 상한에서 멈춰 오래된 공고를 다 보지 못했을 수 있습니다.`]
    if (reason === 'error') return [`"${keyword}": 수집 중 오류가 나서 중단했습니다. ${s.errors[keyword] ?? ''}`.trim()]
    return []
  })
}

export interface ReportLines {
  /** All sites that finished, added up. `null` when none did. */
  total: string | null
  /** One line per site, only when more than one ran. */
  perSite: { site: string; text: string }[]
  notices: string[]
}

export function reportLines({ runs }: CollectionReport, nameOf: (site: string) => string): ReportLines {
  const several = runs.length > 1
  const prefix = (site: string) => (several ? `${nameOf(site)}: ` : '')
  const finished = runs.flatMap((run) => (run.result.kind === 'ok' ? [run.result.summary] : []))
  return {
    total: finished.length > 0 ? summaryLine(combineSummaries(finished)) : null,
    perSite: several
      ? runs.map(({ site, result }) => ({ site, text: result.kind === 'ok' ? summaryBody(result.summary) : '수집하지 못했습니다.' }))
      : [],
    notices: runs.flatMap(({ site, result }) =>
      result.kind === 'ok'
        ? stopNotices(result.summary).map((notice) => prefix(site) + notice)
        : [`${prefix(site)}수집하지 못했습니다. ${result.message}`],
    ),
  }
}

export function formatDateTime(iso: string): string {
  return new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** The line a site row shows for its latest run. */
export function runStatusLine(run: SiteRunStatus | undefined): string {
  if (!run) return '아직 수집한 적이 없습니다.'
  const when = formatDateTime(run.at)
  return run.result.kind === 'ok' ? `${when} · ${summaryBody(run.result.summary)}` : `${when} · 수집하지 못했습니다. ${run.result.message}`
}
