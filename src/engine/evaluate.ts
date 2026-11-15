import type { Career, CareerFilter, Evaluation, JobPosting, RejectGate, RejectReason, SearchCriteria } from '../shared/types'

export interface EvaluateOptions {
  /** Off once AI scoring judges relevance instead of the keyword gate. */
  requireKeywordMatch?: boolean
}

export type RuleGroup = 'deadline' | 'keyword' | 'location' | 'career' | 'employmentType'

interface EvalContext {
  posting: JobPosting
  criteria: SearchCriteria
  now: Date
  matchedKeywords: string[]
  requireKeywordMatch: boolean
}

export interface RuleGate {
  group: RuleGroup
  gate: Exclude<RejectGate, 'lowScore'>
  label: string
  check: (ctx: EvalContext) => RejectReason | null
}

// --- 1. 텍스트 / 키워드 매칭 도우미 ---

const PLAIN_KEYWORD = /^[A-Za-z0-9+#.]+$/
const CORP_PREFIX = /^(?:\(주\)|㈜|주식회사)\s*|\s*(?:\(주\)|㈜|주식회사)$/g

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function stripCompanyFromTitle(title: string, company: string): string {
  const name = company.trim()
  if (!name) return title
  let stripped = title.replaceAll(name, ' ')
  const core = name.replace(CORP_PREFIX, '').trim()
  if (core.length >= 2 && core !== name) stripped = stripped.replaceAll(core, ' ')
  return stripped.replace(/\s+/g, ' ').trim()
}

/** Ported from matcher.py::_keyword_in_text, without its free-text special cases. */
export function keywordInText(keyword: string, text: string): boolean {
  const k = keyword.trim()
  if (!k || !text) return false
  if (PLAIN_KEYWORD.test(k)) return new RegExp(`(?<![A-Za-z])${escapeRegExp(k)}(?![A-Za-z])`, 'i').test(text)
  return text.toLowerCase().includes(k.toLowerCase())
}

function findMatchingKeywords(keywords: readonly string[], posting: JobPosting): string[] {
  const name = posting.company.trim().toLowerCase()
  const core = name.replace(CORP_PREFIX, '').trim()
  const titleWithoutCompany = stripCompanyFromTitle(posting.title, posting.company)
  return keywords.filter((keyword) => {
    const k = keyword.trim().toLowerCase()
    const titleText = k !== '' && (k === name || k === core) ? posting.title : titleWithoutCompany
    return [titleText, ...posting.jobTags].some((text) => keywordInText(keyword, text))
  })
}

// --- 2. 지역 / 경력 판별 도우미 ---

function regionAllowed(posting: JobPosting, preferred: readonly string[]): boolean {
  const wanted = preferred.map((name) => name.trim()).filter(Boolean)
  if (wanted.length === 0 || posting.locations.length === 0) return true
  return posting.locations.some((location) => {
    const region = (location.split('>')[0] ?? '').trim()
    return wanted.some((name) => region.startsWith(name))
  })
}

const INCOMPATIBLE_CAREER: Record<CareerFilter, Career['kind'] | null> = {
  any: null,
  new: 'experienced',
  experienced: 'new',
}

// --- 3. 구조별 규칙 게이트 테이블 (순서대로 평가) ---

export const RULE_GATES: readonly RuleGate[] = [
  {
    group: 'deadline',
    gate: 'expired',
    label: '마감일 경과',
    check: ({ posting, now }) =>
      posting.deadline !== null && Date.parse(posting.deadline) < now.getTime() ? { gate: 'expired' } : null,
  },
  {
    group: 'keyword',
    gate: 'keywordMismatch',
    label: '선호 키워드 불일치 (AI OFF 전용)',
    check: ({ criteria, matchedKeywords, requireKeywordMatch }) =>
      requireKeywordMatch && criteria.keywords.length > 0 && matchedKeywords.length === 0
        ? { gate: 'keywordMismatch' }
        : null,
  },
  {
    group: 'location',
    gate: 'location',
    label: '희망 지역 불일치',
    check: ({ posting, criteria }) => (regionAllowed(posting, criteria.locations) ? null : { gate: 'location' }),
  },
  {
    group: 'career',
    gate: 'career',
    label: '희망 경력 불일치',
    check: ({ posting, criteria }) =>
      posting.career.kind === INCOMPATIBLE_CAREER[criteria.career] ? { gate: 'career' } : null,
  },
  {
    group: 'employmentType',
    gate: 'employmentType',
    label: '희망 고용형태 불일치',
    check: ({ posting, criteria }) => {
      if (criteria.employmentTypes.length === 0) return null
      const types = posting.employmentTypes ?? []
      if (types.length === 0) return null
      return types.some((t) => criteria.employmentTypes.includes(t)) ? null : { gate: 'employmentType' }
    },
  },
]

export function evaluate(
  posting: JobPosting,
  criteria: SearchCriteria,
  now: Date,
  { requireKeywordMatch = true }: EvaluateOptions = {},
): Evaluation {
  const matchedKeywords = findMatchingKeywords(criteria.keywords, posting)
  const ctx: EvalContext = { posting, criteria, now, matchedKeywords, requireKeywordMatch }

  for (const rule of RULE_GATES) {
    const reason = rule.check(ctx)
    if (reason) return { kind: 'reject', reason }
  }
  return { kind: 'pass', matchedKeywords }
}
