import { z } from 'zod'
import type { NextFlightQueryExtract, SiteAdapter } from '../adapter/schema'
import { parseEmploymentText } from '../shared/employment'
import type { Career, EmploymentType, JobPosting } from '../shared/types'
import { findDehydratedQuery, readFlightPayload } from './flight'
import { extractHtmlPage } from './htmlExtract'
import { getPath } from './path'

const rawPosting = z.object({
  externalId: z.union([z.string(), z.number()]).transform(String).pipe(z.string().min(1)),
  title: z.string().min(1),
  company: z.string().min(1),
  postedAt: z.string().refine((s) => !Number.isNaN(Date.parse(s))),
  deadline: z.string().nullish(),
  careerCode: z.union([z.string(), z.number()]).transform(String),
  careerMinYears: z.number().nullish(),
  areaCodes: z.array(z.string()).nullish(),
  employmentCodes: z.array(z.string()).nullish(),
  jobTags: z.string().nullish(),
})

function requireQuery(payload: string, key: string, site: string): unknown {
  const query = findDehydratedQuery(payload, key)
  if (query === undefined) throw new Error(`${site}: 응답에서 ${key} 쿼리를 찾지 못했습니다 (사이트 구조 변경 가능성)`)
  return query
}

type CodeLookup = NextFlightQueryExtract['areaCodes']

function codeLabels(spec: CodeLookup, query: unknown): Map<string, string> {
  const table = getPath(query, spec.tablePath)
  const labels = new Map<string, string>()
  for (const row of Array.isArray(table) ? table : []) {
    const code = getPath(row, spec.codeField)
    const label = getPath(row, spec.labelField)
    if (typeof code === 'string' && typeof label === 'string') labels.set(code, label)
  }
  return labels
}

function toEmploymentTypes(codes: readonly string[] | null | undefined, labels: ReadonlyMap<string, string>): EmploymentType[] {
  if (!codes || codes.length === 0 || labels.size === 0) return []
  const rawLabels = codes.map((entry) => labels.get(entry.split('/')[0] ?? entry) ?? '').filter(Boolean)
  return parseEmploymentText(rawLabels.join(','))
}

function toCareer(extract: NextFlightQueryExtract, code: string, minYears: number | null | undefined): Career {
  const kind = extract.careerCodes[code]
  if (kind === undefined) return { kind: 'unknown' }
  if (kind === 'new' || kind === 'any') return { kind }
  const specified = minYears != null && !extract.careerMinYearsUnspecified.includes(minYears)
  return { kind, minYears: specified ? minYears : null }
}

function toDeadline(extract: NextFlightQueryExtract, value: string | null | undefined): string | null {
  if (!value) return null
  return new Date(value).getUTCFullYear() >= extract.noDeadlineFromYear ? null : value
}

export interface ExtractedPage {
  postings: JobPosting[]
  totalPages: number | null
  /** Ids whose displayed date is an edit date rather than original posting date (so a bumped known item does not cut off newer ones). */
  modifiedIds?: ReadonlySet<string>
}

export function extractPage(adapter: SiteAdapter, html: string): ExtractedPage {
  if (adapter.extract.kind === 'html-selectors') return extractHtmlPage(adapter, adapter.extract, html)
  const { extract } = adapter
  const payload = readFlightPayload(html)
  const query = requireQuery(payload, extract.queryKey, adapter.id)
  const items = getPath(query, extract.itemsPath)
  if (!Array.isArray(items)) throw new Error(`${adapter.id}: ${extract.itemsPath} 경로에 목록이 없습니다`)

  const labels = codeLabels(extract.areaCodes, requireQuery(payload, extract.areaCodes.queryKey, adapter.id))
  const employmentSpec = extract.employmentCodes
  const employmentQuery = employmentSpec ? findDehydratedQuery(payload, employmentSpec.queryKey) : undefined
  const employmentLabels = employmentSpec && employmentQuery !== undefined ? codeLabels(employmentSpec, employmentQuery) : new Map<string, string>()
  const postings: JobPosting[] = []
  for (const item of items) {
    const candidate = Object.fromEntries(
      Object.entries(extract.fields).map(([name, path]) => [name, getPath(item, path)]),
    )
    const parsed = rawPosting.safeParse(candidate)
    if (!parsed.success) continue
    const raw = parsed.data
    postings.push({
      site: adapter.id,
      externalId: raw.externalId,
      title: raw.title,
      company: raw.company,
      locations: (raw.areaCodes ?? []).map((code) => labels.get(code) ?? code),
      career: toCareer(extract, raw.careerCode, raw.careerMinYears),
      employmentTypes: toEmploymentTypes(raw.employmentCodes, employmentLabels),
      jobTags: (raw.jobTags ?? '').split(extract.jobTagsSeparator).filter(Boolean),
      postedAt: raw.postedAt,
      deadline: toDeadline(extract, raw.deadline),
      url: adapter.postingUrlTemplate.replace('{id}', raw.externalId),
    })
  }
  if (items.length > 0 && postings.length === 0) {
    throw new Error(`${adapter.id}: 항목 ${items.length}개를 모두 해석하지 못했습니다 (필드 경로 확인 필요)`)
  }
  const total = getPath(query, extract.totalPagesPath)
  return { postings, totalPages: typeof total === 'number' ? total : null }
}

export function extractPostings(adapter: SiteAdapter, html: string): JobPosting[] {
  return extractPage(adapter, html).postings
}
