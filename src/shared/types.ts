export type CareerFilter = 'any' | 'new' | 'experienced'

export interface SearchCriteria {
  keywords: string[]
  excludeKeywords: string[]
  locations: string[]
  career: CareerFilter
  initialDays: number
  description: string
}

export type Career =
  | { kind: 'new' }
  | { kind: 'any' }
  | { kind: 'experienced'; minYears: number | null }
  | { kind: 'newOrExperienced'; minYears: number | null }
  | { kind: 'unknown' }

export interface JobPosting {
  site: string
  externalId: string
  title: string
  company: string
  locations: string[]
  career: Career
  jobTags: string[]
  postedAt: string
  deadline: string | null
  url: string
}
