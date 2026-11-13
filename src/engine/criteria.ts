import { z } from 'zod'
import type { SearchCriteria } from '../shared/types'

export const DEFAULT_CRITERIA: SearchCriteria = {
  keywords: [],
  excludeKeywords: [],
  locations: [],
  career: 'any',
  initialDays: 7,
  description: '',
}

const criteriaSchema = z.object({
  keywords: z.array(z.string()),
  excludeKeywords: z.array(z.string()),
  locations: z.array(z.string()),
  career: z.enum(['any', 'new', 'experienced']),
  initialDays: z.number().int().min(1),
  description: z.string(),
})

/** Storage is a trust boundary: anything unreadable falls back to the defaults. */
export function parseCriteria(value: unknown): SearchCriteria {
  const parsed = criteriaSchema.safeParse(value)
  return parsed.success ? normalizeCriteria(parsed.data) : DEFAULT_CRITERIA
}

const cleanList = (items: readonly string[]) => [...new Set(items.map((item) => item.trim()).filter(Boolean))]

export function normalizeCriteria(criteria: SearchCriteria): SearchCriteria {
  return {
    ...criteria,
    keywords: cleanList(criteria.keywords),
    excludeKeywords: cleanList(criteria.excludeKeywords),
    locations: cleanList(criteria.locations),
    initialDays: Math.max(1, Math.round(criteria.initialDays) || DEFAULT_CRITERIA.initialDays),
  }
}

const asSet = (items: readonly string[]) => [...items].sort().join('\n')

/** The description is for AI scoring (stage 4) and does not affect rule results yet. */
export function criteriaChanged(before: SearchCriteria, after: SearchCriteria): boolean {
  const a = normalizeCriteria(before)
  const b = normalizeCriteria(after)
  return (
    asSet(a.keywords) !== asSet(b.keywords) ||
    asSet(a.excludeKeywords) !== asSet(b.excludeKeywords) ||
    asSet(a.locations) !== asSet(b.locations) ||
    a.career !== b.career ||
    a.initialDays !== b.initialDays
  )
}
