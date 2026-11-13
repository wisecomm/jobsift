import type { AiInput } from '../ai/settings'
import type {
  AiSettingsView,
  CollectionSummary,
  PostingKey,
  PostingPatch,
  ScoringSummary,
  SearchCriteria,
  StoredPosting,
  UpdateResult,
} from './types'

export type Request =
  | { type: 'getCriteria' }
  | { type: 'getAiSettings' }
  /** An empty `ai.apiKey` keeps the saved key. */
  | { type: 'saveSettings'; criteria: SearchCriteria; ai: AiInput }
  | { type: 'deleteAiKey' }
  /** An empty `apiKey` checks the saved key. */
  | { type: 'checkAiKey'; apiKey: string; model: string }
  | { type: 'collect' }
  | { type: 'scorePending' }
  | { type: 'pendingCount' }
  | { type: 'listPostings' }
  | { type: 'updatePosting'; key: PostingKey; patch: PostingPatch }
  | { type: 'devReset' }

export interface SettingsResult {
  changed: boolean
  /** Postings the changed rules turned away. */
  removed: number
  /** Postings now waiting for an AI score. */
  queued: number
}

export interface ResponseData {
  getCriteria: SearchCriteria
  getAiSettings: AiSettingsView
  saveSettings: SettingsResult
  deleteAiKey: SettingsResult
  checkAiKey: { ok: true } | { ok: false; message: string }
  collect: CollectionSummary
  scorePending: ScoringSummary
  pendingCount: number
  listPostings: StoredPosting[]
  updatePosting: UpdateResult
  devReset: CollectionSummary
}

export type ResponseFor<R extends Request> = { ok: true; data: ResponseData[R['type']] } | { ok: false; error: string }
