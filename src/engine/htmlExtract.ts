import { parse, type HTMLElement } from 'node-html-parser'
import type { HtmlFieldRule, HtmlSelectorsExtract, SiteAdapter } from '../adapter/schema'
import { DAY_MS } from '../shared/date'
import { inferEmploymentFromTitle, parseEmploymentText } from '../shared/employment'
import type { Career, JobPosting } from '../shared/types'
import type { ExtractedPage } from './extractPostings'

const REGION_PREFIXES: readonly (readonly [prefix: string, canonical: string])[] = [
  ['서울특별시', '서울'],
  ['서울시', '서울'],
  ['서울', '서울'],
  ['부산광역시', '부산'],
  ['부산시', '부산'],
  ['부산', '부산'],
  ['대구광역시', '대구'],
  ['대구시', '대구'],
  ['대구', '대구'],
  ['인천광역시', '인천'],
  ['인천시', '인천'],
  ['인천', '인천'],
  ['광주광역시', '광주'],
  ['광주시', '광주'],
  ['광주', '광주'],
  ['대전광역시', '대전'],
  ['대전시', '대전'],
  ['대전', '대전'],
  ['울산광역시', '울산'],
  ['울산시', '울산'],
  ['울산', '울산'],
  ['세종특별자치시', '세종'],
  ['세종시', '세종'],
  ['세종', '세종'],
  ['경기도', '경기'],
  ['경기', '경기'],
  ['강원특별자치도', '강원'],
  ['강원도', '강원'],
  ['강원', '강원'],
  ['충청북도', '충북'],
  ['충북', '충북'],
  ['충청남도', '충남'],
  ['충남', '충남'],
  ['전북특별자치도', '전북'],
  ['전라북도', '전북'],
  ['전북', '전북'],
  ['전라남도', '전남'],
  ['전남', '전남'],
  ['경상북도', '경북'],
  ['경북', '경북'],
  ['경상남도', '경남'],
  ['경남', '경남'],
  ['제주특별자치도', '제주'],
  ['제주도', '제주'],
  ['제주', '제주'],
]

const collapseSpaces = (text: string) => text.replace(/\s+/g, ' ').trim()

function readField(root: HTMLElement, field: HtmlFieldRule): string {
  const el = field.selector ? root.querySelector(field.selector) : root
  if (!el) return ''
  const raw = field.attr ? (el.getAttribute(field.attr) ?? '') : el.text
  const normalized = collapseSpaces(raw)
  if (!field.pattern) return normalized
  return new RegExp(field.pattern).exec(normalized)?.[1]?.trim() ?? ''
}

function validCalendarDate(year: number, month: number, day: number): string | null {
  const d = new Date(Date.UTC(year, month - 1, day))
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null
  const mm = String(month).padStart(2, '0')
  const dd = String(day).padStart(2, '0')
  return `${year}-${mm}-${dd}`
}

export function parsePostedAtDate(raw: string): string | null {
  const match = /(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})/.exec(raw)
  if (!match) return null
  const year = match[1]!.length === 2 ? 2000 + Number(match[1]) : Number(match[1])
  const date = validCalendarDate(year, Number(match[2]), Number(match[3]))
  return date ? `${date}T00:00:00+09:00` : null
}

export function parseDeadlineDate(raw: string, postedAtIso: string): string | null {
  const full = /(\d{2,4})[\/.-](\d{1,2})[\/.-](\d{1,2})/.exec(raw)
  if (full) {
    const year = full[1]!.length === 2 ? 2000 + Number(full[1]) : Number(full[1])
    const date = validCalendarDate(year, Number(full[2]), Number(full[3]))
    return date ? `${date}T23:59:59+09:00` : null
  }
  const monthDay = /(\d{1,2})[\/.-](\d{1,2})/.exec(raw)
  if (!monthDay) return null
  const postedYear = Number(postedAtIso.slice(0, 4))
  const month = Number(monthDay[1])
  const day = Number(monthDay[2])
  const postedMs = Date.parse(postedAtIso.slice(0, 10))
  const candidateMs = Date.UTC(postedYear, month - 1, day)
  // A deadline like "01/05" on a late-December posting belongs to the next calendar year.
  const year = candidateMs - postedMs < -60 * DAY_MS ? postedYear + 1 : postedYear
  const date = validCalendarDate(year, month, day)
  return date ? `${date}T23:59:59+09:00` : null
}

export function parseCareerText(raw: string): Career {
  const text = raw.replace(/\s+/g, '')
  if (!text) return { kind: 'unknown' }
  if (text.includes('무관')) return { kind: 'any' }
  const yearsMatch = /(\d+)년/.exec(text)
  const minYears = yearsMatch ? Number(yearsMatch[1]) : null
  if (text.includes('신입') && text.includes('경력')) return { kind: 'newOrExperienced', minYears }
  if (text.includes('신입')) return { kind: 'new' }
  if (text.includes('경력')) return { kind: 'experienced', minYears }
  return { kind: 'unknown' }
}

export function inferRegionFromCompany(company: string): string[] {
  const name = collapseSpaces(company)
  for (const [prefix, canonical] of REGION_PREFIXES) {
    if (name.startsWith(prefix)) return [canonical]
  }
  return []
}

function parseTotalPages(doc: HTMLElement, extract: HtmlSelectorsExtract, pageSize: number): number | null {
  if (!extract.totalCountSelector) return null
  const el = doc.querySelector(extract.totalCountSelector)
  if (!el) return null
  const digits = /(\d+)/.exec(el.text.replaceAll(',', ''))
  return digits ? Math.ceil(Number(digits[1]) / pageSize) : null
}

export function extractHtmlPage(adapter: SiteAdapter, extract: HtmlSelectorsExtract, html: string): ExtractedPage {
  const doc = parse(html)
  if (!doc.querySelector(extract.readySelector)) {
    throw new Error(`${adapter.id}: 응답에서 목록 영역(${extract.readySelector})을 찾지 못했습니다 (사이트 구조 변경 가능성)`)
  }

  const allItems = doc.querySelectorAll(extract.itemSelector)
  const items = extract.emptyItemSelector
    ? allItems.filter((item) => item.querySelector(extract.emptyItemSelector!) === null)
    : allItems

  const postings: JobPosting[] = []
  const modifiedIds = new Set<string>()

  for (const item of items) {
    const externalId = readField(item, extract.fields.externalId)
    const title = readField(item, extract.fields.title)
    const company = readField(item, extract.fields.company)
    const postedAtRaw = readField(item, extract.fields.postedAt)
    const postedAt = parsePostedAtDate(postedAtRaw)
    if (!externalId || !title || !company || !postedAt) continue

    if (extract.modifiedMarker && postedAtRaw.includes(extract.modifiedMarker)) {
      modifiedIds.add(externalId)
    }

    const deadlineRaw = extract.fields.deadline ? readField(item, extract.fields.deadline) : ''
    const deadline = deadlineRaw ? parseDeadlineDate(deadlineRaw, postedAt) : null

    const locations = extract.locationPartsSelector
      ? (() => {
          const parts = item.querySelectorAll(extract.locationPartsSelector).map((el) => collapseSpaces(el.text)).filter(Boolean)
          return parts.length > 0 ? [parts.join('>')] : []
        })()
      : extract.inferLocationFromCompany
        ? inferRegionFromCompany(company)
        : []

    const career = extract.careerSelector
      ? parseCareerText(collapseSpaces(item.querySelector(extract.careerSelector)?.text ?? ''))
      : ({ kind: 'unknown' } as const)

    const employmentTypes = extract.employmentSelector
      ? parseEmploymentText(
          item
            .querySelectorAll(extract.employmentSelector)
            .map((el) => collapseSpaces(el.text))
            .filter(Boolean)
            .join(','),
        )
      : extract.inferEmploymentFromTitle
        ? inferEmploymentFromTitle(title)
        : []

    const jobTags = extract.jobTagsSelector
      ? item.querySelectorAll(extract.jobTagsSelector).map((el) => collapseSpaces(el.text)).filter(Boolean)
      : []

    postings.push({
      site: adapter.id,
      externalId,
      title,
      company,
      locations,
      career,
      employmentTypes,
      jobTags,
      postedAt,
      deadline,
      url: adapter.postingUrlTemplate.replace('{id}', externalId),
    })
  }

  if (items.length > 0 && postings.length === 0) {
    throw new Error(`${adapter.id}: 항목 ${items.length}개를 모두 해석하지 못했습니다 (선택자 확인 필요)`)
  }

  return {
    postings,
    totalPages: parseTotalPages(doc, extract, adapter.search.pageSize),
    modifiedIds,
  }
}
