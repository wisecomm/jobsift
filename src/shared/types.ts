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

export type PostingStatus = 'new' | 'saved' | 'applied' | 'dismissed' | 'expired'

export type RejectReason =
  | { gate: 'expired' }
  | { gate: 'excludeKeyword'; keyword: string }
  | { gate: 'keywordMismatch' }
  | { gate: 'location' }
  | { gate: 'career' }

export type RejectGate = RejectReason['gate']

export type Evaluation = { kind: 'pass'; matchedKeywords: string[] } | { kind: 'reject'; reason: RejectReason }

export interface StoredPosting extends JobPosting {
  status: PostingStatus
  memo: string
  matchedKeywords: string[]
  score: number | null
  scoreReason: string | null
  collectedAt: string
  updatedAt: string
}

/** Identity only, on purpose: a discarded posting keeps no title, company or url. */
export interface DiscardRecord {
  site: string
  externalId: string
  reason: RejectReason
  discardedAt: string
  deadline: string | null
}

export interface CollectState {
  site: string
  keyword: string
  lastCollectedAt: string
}

export type PostingKey = Pick<JobPosting, 'site' | 'externalId'>

export type StopReason = 'cutoff' | 'known' | 'exhausted' | 'page-cap' | 'error'

export interface CollectionSummary {
  scanned: number
  saved: number
  discarded: number
  discardedByGate: Record<RejectGate, number>
  expiredMarked: number
  stopReasons: Record<string, StopReason>
  errors: Record<string, string>
}
