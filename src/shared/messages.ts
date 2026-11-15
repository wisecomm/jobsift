import type { AiInput } from '../ai/settings'
import type {
  AiProvider,
  AiSettingsView,
  AiUsageRecord,
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
  | { type: 'getAiUsage' }
  | { type: 'clearAiUsage' }
  /** An empty `ai.apiKey` keeps the saved key. */
  | { type: 'saveSettings'; criteria: SearchCriteria; ai: AiInput }
  | { type: 'deleteAiKey'; provider?: AiProvider }
  /** An empty `apiKey` checks the saved key. */
  | { type: 'checkAiKey'; provider?: AiProvider; apiKey: string; model: string }
  | { type: 'getSiteSettings' }
  /** Refused when it would leave no site on. */
  | {
      type: 'saveSiteSettings'
      enabledSites: string[]
      siteOrder?: string[]
      maxItemsBySite?: Record<string, number>
      keywordsBySite?: Record<string, string[]>
    }
  /** Without `site`, every enabled site; with it, that site only. When `continueFromCap`, resumes from saved page-cap cursor. */
  | { type: 'collect'; site?: string; keyword?: string; continueFromCap?: boolean }
  | { type: 'scorePending' }
  | { type: 'pendingCount' }
  | { type: 'listPostings' }
  | { type: 'updatePosting'; key: PostingKey; patch: PostingPatch }
  | { type: 'resetCollect' }
  | { type: 'cancelWork' }

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
  /** Resumable keywords per site that stopped at maxItems. */
  resumableBySite?: Record<string, string[]>
}

export interface ResponseData {
  getCriteria: SearchCriteria
  getAiSettings: AiSettingsView
  getAiUsage: AiUsageRecord
  clearAiUsage: AiUsageRecord
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
  resetCollect: CollectionReport
  cancelWork: boolean
}

export type ResponseFor<R extends Request> = { ok: true; data: ResponseData[R['type']] } | { ok: false; error: string }
