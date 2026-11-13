import type { AiInput } from '../ai/settings'
import type {
  AiSettingsView,
  CollectionReport,
  PostingKey,
  PostingPatch,
  ScoringSummary,
  SearchCriteria,
  SiteRunStatus,
  SiteSettings,
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
  | { type: 'getSiteSettings' }
  /** Refused when it would leave no site on. */
  | { type: 'saveSiteSettings'; enabledSites: string[]; siteOrder?: string[] }
  /** Without `site`, every enabled site; with it, that site only. */
  | { type: 'collect'; site?: string }
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

export interface SiteSettingsView {
  settings: SiteSettings
  /** Latest run per site id. */
  runs: Record<string, SiteRunStatus>
}

export interface ResponseData {
  getCriteria: SearchCriteria
  getAiSettings: AiSettingsView
  saveSettings: SettingsResult
  deleteAiKey: SettingsResult
  checkAiKey: { ok: true } | { ok: false; message: string }
  getSiteSettings: SiteSettingsView
  saveSiteSettings: SiteSettings
  collect: CollectionReport
  scorePending: ScoringSummary
  pendingCount: number
  listPostings: StoredPosting[]
  updatePosting: UpdateResult
  devReset: CollectionReport
}

export type ResponseFor<R extends Request> = { ok: true; data: ResponseData[R['type']] } | { ok: false; error: string }
