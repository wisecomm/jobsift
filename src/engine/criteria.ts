import { z } from 'zod'
import type { SearchCriteria } from '../shared/types'

export const DEFAULT_CRITERIA: SearchCriteria = {
  keywords: [],
  locations: [],
  career: 'any',
  description: '',
}

const criteriaSchema = z.object({
  keywords: z.array(z.string()),
  locations: z.array(z.string()),
  career: z.enum(['any', 'new', 'experienced']),
  description: z.string(),
})

/** Storage is a trust boundary: anything unreadable falls back to the defaults. */
export function parseCriteria(value: unknown): SearchCriteria {
  const parsed = criteriaSchema.safeParse(value)
  return parsed.success ? normalizeCriteria(parsed.data) : DEFAULT_CRITERIA
}

const cleanList = (items: readonly string[] = []) => [...new Set(items.map((item) => item.trim()).filter(Boolean))]

export function normalizeCriteria(criteria: SearchCriteria): SearchCriteria {
  return {
    ...criteria,
    keywords: cleanList(criteria.keywords),
    locations: cleanList(criteria.locations),
  }
}

const asSet = (items: readonly string[]) => [...items].sort().join('\n')

/** Rule fields only. The description, model and score threshold count through `settingsChanged`, and only when AI is on. */
export function criteriaChanged(before: SearchCriteria, after: SearchCriteria): boolean {
  const a = normalizeCriteria(before)
  const b = normalizeCriteria(after)
  return (
    asSet(a.keywords) !== asSet(b.keywords) ||
    asSet(a.locations) !== asSet(b.locations) ||
    a.career !== b.career
  )
}
