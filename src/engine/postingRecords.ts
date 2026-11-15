import {
  postingSources,
  type DiscardRecord,
  type JobPosting,
  type PendingPosting,
  type PostingSource,
  type PostingTokenUsage,
  type RejectReason,
  type StoredPosting,
} from '../shared/types'

export type PostingCandidate = JobPosting & { alsoOn?: PostingSource[] }

function basePosting(posting: PostingCandidate): PostingCandidate {
  const base: PostingCandidate = {
    site: posting.site,
    externalId: posting.externalId,
    title: posting.title,
    company: posting.company,
    locations: posting.locations,
    career: posting.career,
    jobTags: posting.jobTags,
    postedAt: posting.postedAt,
    deadline: posting.deadline,
    url: posting.url,
  }
  if (posting.employmentTypes !== undefined) base.employmentTypes = posting.employmentTypes
  if (posting.alsoOn !== undefined) base.alsoOn = posting.alsoOn
  return base
}

export interface StoredPostingInit {
  matchedKeywords: string[]
  score: number | null
  scoreReason: string | null
  tokenUsage?: PostingTokenUsage
  collectedAt: string
  updatedAt: string
}

/** Builds a new StoredPosting, stripping any pending/prior lifecycle fields. */
export function toStoredPosting(
  posting: PostingCandidate,
  { matchedKeywords, score, scoreReason, tokenUsage, collectedAt, updatedAt }: StoredPostingInit,
): StoredPosting {
  const stored: StoredPosting = {
    ...basePosting(posting),
    status: 'new',
    memo: '',
    matchedKeywords,
    score,
    scoreReason,
    collectedAt,
    updatedAt,
  }
  if (tokenUsage !== undefined) stored.tokenUsage = tokenUsage
  return stored
}

/** Builds a PendingPosting for the AI scoring queue. */
export function toPendingPosting(
  posting: PostingCandidate,
  matchedKeywords: string[],
  queuedAt: string,
): PendingPosting {
  return {
    ...basePosting(posting),
    matchedKeywords,
    queuedAt,
  }
}

/** Expands a single or cross-site merged posting into per-site discard records. */
export function toDiscardRecords(
  posting: Pick<JobPosting, 'site' | 'externalId' | 'url' | 'deadline'> & { alsoOn?: readonly PostingSource[] },
  reason: RejectReason,
  discardedAt: string,
): DiscardRecord[] {
  return postingSources(posting).map((source) => ({
    site: source.site,
    externalId: source.externalId,
    reason,
    discardedAt,
    deadline: posting.deadline,
  }))
}
