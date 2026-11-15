import type { AiProvider } from '../shared/types'

export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const GEMINI_API_REVISION = '2026-05-20'
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
export const EXAONE_ENDPOINT = 'https://api.exaone.ai/v1/chat/completions'
export const EXAONE_DEFAULT_MODEL = 'k-exaone_v2.5'
export const DEFAULT_PROVIDER: AiProvider = 'gemini'
export const DEFAULT_MODELS: Record<AiProvider, string> = {
  gemini: DEFAULT_MODEL,
  exaone: EXAONE_DEFAULT_MODEL,
}
export const AI_PROVIDER_LABELS: Record<AiProvider, string> = {
  gemini: 'Google Gemini (기본값)',
  exaone: 'LG EXAONE (K-EXAONE 2.5)',
}
export const DEFAULT_MIN_SCORE = 60

/** Postings scored per request, to spare the user's quota. */
export const BATCH_SIZE = 10
/** Pause between scoring requests, for free-tier rate limits. */
export const REQUEST_GAP_MS = 4000
/** Longer pause for EXAONE after each batch completes, to avoid concurrency busy errors. */
export const EXAONE_REQUEST_GAP_MS = 6000
export const REQUEST_TIMEOUT_MS = 180_000
/** Room for ten one-sentence reasons plus any thinking the model does before answering. */
export const MAX_OUTPUT_TOKENS = 8192
