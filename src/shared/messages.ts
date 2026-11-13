import type { JobPosting, SearchCriteria } from './types'

export interface CollectRequest {
  type: 'collect'
  criteria: SearchCriteria
}

export type CollectResponse = { ok: true; postings: JobPosting[] } | { ok: false; error: string }
