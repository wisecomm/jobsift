import type { CollectionSummary, SearchCriteria, StoredPosting } from './types'

export type Request =
  | { type: 'getCriteria' }
  | { type: 'saveCriteria'; criteria: SearchCriteria }
  | { type: 'collect' }
  | { type: 'listPostings' }
  | { type: 'devReset' }

export interface ResponseData {
  getCriteria: SearchCriteria
  saveCriteria: { changed: boolean; removed: number }
  collect: CollectionSummary
  listPostings: StoredPosting[]
  devReset: CollectionSummary
}

export type ResponseFor<R extends Request> = { ok: true; data: ResponseData[R['type']] } | { ok: false; error: string }
