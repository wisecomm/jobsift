import type { Evaluation, JobPosting, SearchCriteria } from '../shared/types'

export interface EvaluateOptions {
  /** Off once AI scoring judges relevance instead of the keyword gate. */
  requireKeywordMatch?: boolean
}

const PLAIN_KEYWORD = /^[A-Za-z0-9+#.]+$/

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Ported from matcher.py::_keyword_in_text, without its free-text special cases. */
export function keywordInText(keyword: string, text: string): boolean {
  const k = keyword.trim()
  if (!k || !text) return false
  if (PLAIN_KEYWORD.test(k)) return new RegExp(`(?<![A-Za-z])${escapeRegExp(k)}(?![A-Za-z])`, 'i').test(text)
  return text.toLowerCase().includes(k.toLowerCase())
}

function findKeywords(keywords: readonly string[], texts: readonly string[]): string[] {
  return keywords.filter((keyword) => texts.some((text) => keywordInText(keyword, text)))
}

function regionAllowed(posting: JobPosting, preferred: readonly string[]): boolean {
  const wanted = preferred.map((name) => name.trim()).filter(Boolean)
  if (wanted.length === 0 || posting.locations.length === 0) return true
  return posting.locations.some((location) => {
    const region = (location.split('>')[0] ?? '').trim()
    return wanted.some((name) => region.startsWith(name))
  })
}

export function evaluate(
  posting: JobPosting,
  criteria: SearchCriteria,
  now: Date,
  { requireKeywordMatch = true }: EvaluateOptions = {},
): Evaluation {
  if (posting.deadline !== null && Date.parse(posting.deadline) < now.getTime()) {
    return { kind: 'reject', reason: { gate: 'expired' } }
  }

  const texts = [posting.title, ...posting.jobTags]
  const excluded = findKeywords(criteria.excludeKeywords, texts)[0]
  if (excluded !== undefined) return { kind: 'reject', reason: { gate: 'excludeKeyword', keyword: excluded } }

  const matchedKeywords = findKeywords(criteria.keywords, texts)
  if (requireKeywordMatch && criteria.keywords.length > 0 && matchedKeywords.length === 0) {
    return { kind: 'reject', reason: { gate: 'keywordMismatch' } }
  }

  if (!regionAllowed(posting, criteria.locations)) return { kind: 'reject', reason: { gate: 'location' } }

  const careerKind = posting.career.kind
  if (
    (criteria.career === 'new' && careerKind === 'experienced') ||
    (criteria.career === 'experienced' && careerKind === 'new')
  ) {
    return { kind: 'reject', reason: { gate: 'career' } }
  }

  return { kind: 'pass', matchedKeywords }
}
