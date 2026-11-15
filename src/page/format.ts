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
    `(키워드 불일치 ${g.keywordMismatch}, 지역 ${g.location}, 경력 ${g.career}, 마감 ${g.expired}) · 마감 처리 ${s.expiredMarked}건`
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
    discardedByGate: { expired: 0, keywordMismatch: 0, location: 0, career: 0, lowScore: 0 },
    expiredMarked: 0,
  }
  for (const s of summaries) {
    total.scanned += s.scanned
    total.saved += s.saved
    total.queued += s.queued
    total.discarded += s.discarded
    total.expiredMarked += s.expiredMarked
    for (const gate of Object.keys(total.discardedByGate) as (keyof Totals['discardedByGate'])[]) {
      total.discardedByGate[gate] += s.discardedByGate[gate]
    }
  }
  return total
}

export function scoringLine(r: ScoringSummary): string {
  const base = `AI 채점: ${r.scored}건 채점 · 저장 ${r.kept}건 · 점수 미달 ${r.lowScore}건 · 채점 대기 ${r.pendingLeft}건`
  if (!r.usage || r.usage.totalTokens <= 0) return base
  const fmt = (n: number) => n.toLocaleString('ko-KR')
  const thought = r.usage.thoughtTokens > 0 ? ` · 사고 ${fmt(r.usage.thoughtTokens)}` : ''
  return `${base} · 토큰 ${fmt(r.usage.totalTokens)} (입력 ${fmt(r.usage.inputTokens)} · 출력 ${fmt(r.usage.outputTokens)}${thought})`
}

export interface StopNoticeItem {
  keyword?: string
  text: string
  continuable: boolean
}

export interface ReportNotice {
  site: string
  keyword?: string
  text: string
  continuable: boolean
}

export function stopNoticeItems(s: CollectionSummary): StopNoticeItem[] {
  const items: StopNoticeItem[] = []
  let hasPageCap = false
  for (const [keyword, reason] of Object.entries(s.stopReasons)) {
    if (reason === 'page-cap') {
      if (hasPageCap) continue
      hasPageCap = true
      items.push({
        continuable: true,
        text:
          s.maxItems !== undefined
            ? `최대 수집 개수(${s.maxItems.toLocaleString('ko-KR')}건)를 넘어 멈춰 마감 전 공고를 다 보지 못했을 수 있습니다.`
            : '최대 수집 개수를 넘어 멈춰 마감 전 공고를 다 보지 못했을 수 있습니다.',
      })
    } else if (reason === 'error') {
      items.push({ keyword, continuable: false, text: `"${keyword}": 수집 중 오류가 나서 중단했습니다. ${s.errors[keyword] ?? ''}`.trim() })
    }
  }
  return items
}

/** Plain-language notes for keywords whose run did not finish normally. */
export function stopNotices(s: CollectionSummary): string[] {
  return stopNoticeItems(s).map((item) => item.text)
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

export function reportNotices(
  report: CollectionReport | null,
  nameOf: (site: string) => string,
  resumableBySite: Record<string, string[]> = {},
): ReportNotice[] {
  const runs = report?.runs ?? []
  const multipleSites = runs.length > 1 || Object.keys(resumableBySite).length > 1
  const prefix = (site: string) => (multipleSites ? `${nameOf(site)}: ` : '')
  const shownPageCapSites = new Set<string>()
  const notices: ReportNotice[] = []

  for (const { site, result } of runs) {
    if (result.kind !== 'ok') {
      notices.push({ site, continuable: false, text: `${prefix(site)}수집하지 못했습니다. ${result.message}` })
      continue
    }
    for (const item of stopNoticeItems(result.summary)) {
      if (!item.keyword) {
        shownPageCapSites.add(site)
        const hasResumable = site in resumableBySite ? (resumableBySite[site]?.length ?? 0) > 0 : item.continuable
        notices.push({
          site,
          continuable: item.continuable && hasResumable,
          text: `${nameOf(site)} : ${item.text}`,
        })
        continue
      }
      notices.push({
        site,
        keyword: item.keyword,
        continuable: false,
        text: prefix(site) + item.text,
      })
    }
  }

  for (const [site, keywords] of Object.entries(resumableBySite)) {
    if (keywords.length === 0 || shownPageCapSites.has(site)) continue
    shownPageCapSites.add(site)
    notices.push({
      site,
      continuable: true,
      text: `${nameOf(site)} : 최대 수집 개수를 넘어 멈춰 남은 마감 전 공고를 계속 수집할 수 있습니다.`,
    })
  }
  return notices
}

export function formatDateTime(iso: string): string {
  return new Date(Date.parse(iso) + KST_OFFSET_MS).toISOString().slice(0, 16).replace('T', ' ')
}

/** The line a site row shows for its latest run. */
export function runStatusLine(run: SiteRunStatus | undefined): string {
  if (!run) return '아직 수집한 적이 없습니다.'
  const when = formatDateTime(run.at)
  if (run.result.kind !== 'ok') return `${when} · 수집하지 못했습니다. ${run.result.message}`
  const { summary } = run.result
  const tokenText =
    summary.aiOn || summary.tokenUsage
      ? ` · 총 토큰 ${(summary.tokenUsage?.totalTokens ?? 0).toLocaleString('ko-KR')}`
      : ''
  return `${when} · ${summaryBody(summary)}${tokenText}`
}
