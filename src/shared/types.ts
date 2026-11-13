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

/** What a person can set by hand. `expired` is only ever set by the collector. */
export type UserStatus = Exclude<PostingStatus, 'expired'>

export interface PostingPatch {
  status?: UserStatus
  memo?: string
}

export type UpdateResult = { kind: 'updated'; posting: StoredPosting } | { kind: 'not-found' } | { kind: 'expired' }

export type RejectReason =
  | { gate: 'expired' }
  | { gate: 'excludeKeyword'; keyword: string }
  | { gate: 'keywordMismatch' }
  | { gate: 'location' }
  | { gate: 'career' }
  | { gate: 'lowScore'; score: number }

export type RejectGate = RejectReason['gate']

export type Evaluation = { kind: 'pass'; matchedKeywords: string[] } | { kind: 'reject'; reason: RejectReason }

export interface PostingSource {
  site: string
  externalId: string
  url: string
}

export interface StoredPosting extends JobPosting {
  status: PostingStatus
  memo: string
  matchedKeywords: string[]
  score: number | null
  scoreReason: string | null
  collectedAt: string
  updatedAt: string
  /** Other sites where the same posting was collected (Q31). */
  alsoOn?: PostingSource[]
}

/** Passed the rules and waits for an AI score. Becomes a StoredPosting or a DiscardRecord once scored. */
export interface PendingPosting extends JobPosting {
  matchedKeywords: string[]
  queuedAt: string
  /** Other sites where the same posting was collected (Q31). */
  alsoOn?: PostingSource[]
}

export const postingSources = (
  p: Pick<JobPosting, 'site' | 'externalId' | 'url'> & { alsoOn?: readonly PostingSource[] },
): PostingSource[] => [{ site: p.site, externalId: p.externalId, url: p.url }, ...(p.alsoOn ?? [])]

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

export interface AiSettings {
  apiKey: string
  model: string
  /** 0 to 100. */
  minScore: number
}

/** What the page may see: never the key itself. */
export interface AiSettingsView {
  hasKey: boolean
  model: string
  minScore: number
}

export interface ScoringSummary {
  scored: number
  kept: number
  lowScore: number
  pendingLeft: number
  /** Korean message for the batch that stopped the pass, if one did. */
  error: string | null
}

export interface CollectionSummary {
  scanned: number
  saved: number
  /** Postings sent to the scoring queue instead of being stored (AI on). */
  queued: number
  /** Whether this run queued passes for AI scoring instead of storing them. */
  aiOn: boolean
  discarded: number
  discardedByGate: Record<RejectGate, number>
  expiredMarked: number
  stopReasons: Record<string, StopReason>
  errors: Record<string, string>
}

/** The sites collection uses. Always holds at least one id of an available adapter. */
export interface SiteSettings {
  enabledSites: string[]
  siteOrder: string[]
}

export type SiteRunResult = { kind: 'ok'; summary: CollectionSummary } | { kind: 'error'; message: string }

/** What one site's latest collection did. An `error` means the whole site run threw, as opposed to a keyword failing inside it. */
export interface SiteRunStatus {
  site: string
  /** ISO time the run started. */
  at: string
  result: SiteRunResult
}

export interface CollectionReport {
  runs: SiteRunStatus[]
  /** `null` in rules-only mode. */
  scoring: ScoringSummary | null
}
