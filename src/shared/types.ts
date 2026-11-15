export type CareerFilter = 'any' | 'new' | 'experienced'

export interface SearchCriteria {
  keywords: string[]
  locations: string[]
  career: CareerFilter
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

export interface TokenUsage {
  inputTokens: number
  outputTokens: number
  thoughtTokens: number
  cachedTokens: number
  totalTokens: number
}

export interface PostingTokenUsage extends TokenUsage {
  batchSize: number
}

export interface AiModelUsage extends TokenUsage {
  requests: number
}

export interface AiUsageRecord {
  requests: number
  scoredPostings: number
  totals: TokenUsage
  byModel: Record<string, AiModelUsage>
  updatedAt: string | null
}

export interface StoredPosting extends JobPosting {
  status: PostingStatus
  memo: string
  matchedKeywords: string[]
  score: number | null
  scoreReason: string | null
  tokenUsage?: PostingTokenUsage
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

export interface CollectResume {
  nextPage: number
  cutoff: string | null
}

export interface CollectState {
  site: string
  keyword: string
  lastCollectedAt: string
  resume?: CollectResume
}

export type PostingKey = Pick<JobPosting, 'site' | 'externalId'>

export type StopReason = 'cutoff' | 'known' | 'exhausted' | 'page-cap' | 'error'

export type AiProvider = 'gemini' | 'exaone'

export interface AiSettings {
  provider?: AiProvider
  apiKey: string
  model: string
  /** Saved keys per provider so switching providers preserves each key. */
  keys?: Partial<Record<AiProvider, string>>
  /** Saved model overrides per provider. */
  models?: Partial<Record<AiProvider, string>>
  /** 0 to 100. */
  minScore: number
}

/** What the page may see: never the keys themselves. */
export interface AiSettingsView {
  provider: AiProvider
  hasKey: boolean
  model: string
  hasKeyByProvider: Record<AiProvider, boolean>
  modelsByProvider: Record<AiProvider, string>
  minScore: number
}

export interface ScoringSummary {
  scored: number
  kept: number
  lowScore: number
  pendingLeft: number
  usage?: TokenUsage
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
  /** Keyword scan cap applied for this site, if configured. */
  maxItems?: number
  /** AI tokens consumed for this site during this run, when AI scoring ran. */
  tokenUsage?: TokenUsage
}

/** The sites collection uses. Always holds at least one id of an available adapter. */
export interface SiteSettings {
  enabledSites: string[]
  siteOrder: string[]
  /** Per-site keyword scan cap (in postings). Defaults to 2000 when omitted. */
  maxItemsBySite?: Record<string, number>
  /** Per-site keyword override. When omitted or empty, uses `criteria.keywords`. */
  keywordsBySite?: Record<string, string[]>
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
