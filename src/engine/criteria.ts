import { z } from 'zod'
import type { EmploymentType, SearchCriteria } from '../shared/types'

export const DEFAULT_CRITERIA: SearchCriteria = {
  keywords: [],
  locations: [],
  career: 'any',
  employmentTypes: [],
  description: '',
}

const employmentTypeSchema: z.ZodType<EmploymentType> = z.enum([
  'regular',
  'contract',
  'intern',
  'dispatch',
  'freelance',
  'partTime',
  'other',
])

const criteriaSchema = z.object({
  keywords: z.array(z.string()),
  locations: z.array(z.string()),
  career: z.enum(['any', 'new', 'experienced']),
  employmentTypes: z.array(employmentTypeSchema).default([]),
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
    employmentTypes: [...new Set(criteria.employmentTypes)],
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
    a.career !== b.career ||
    asSet(a.employmentTypes) !== asSet(b.employmentTypes)
  )
}
