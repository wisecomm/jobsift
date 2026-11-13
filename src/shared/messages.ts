import type { CollectionSummary, PostingKey, PostingPatch, SearchCriteria, StoredPosting, UpdateResult } from './types'

export type Request =
  | { type: 'getCriteria' }
  | { type: 'saveCriteria'; criteria: SearchCriteria }
  | { type: 'collect' }
  | { type: 'listPostings' }
  | { type: 'updatePosting'; key: PostingKey; patch: PostingPatch }
  | { type: 'devReset' }

export interface ResponseData {
  getCriteria: SearchCriteria
  saveCriteria: { changed: boolean; removed: number }
  collect: CollectionSummary
  listPostings: StoredPosting[]
  updatePosting: UpdateResult
  devReset: CollectionSummary
}

export type ResponseFor<R extends Request> = { ok: true; data: ResponseData[R['type']] } | { ok: false; error: string }
