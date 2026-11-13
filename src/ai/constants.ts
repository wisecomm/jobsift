export const GEMINI_ENDPOINT = 'https://generativelanguage.googleapis.com/v1beta/interactions'
export const GEMINI_API_REVISION = '2026-05-20'
export const DEFAULT_MODEL = 'gemini-3.5-flash-lite'
export const DEFAULT_MIN_SCORE = 60

/** Postings scored per request, to spare the user's quota. */
export const BATCH_SIZE = 10
/** Pause between scoring requests, for free-tier rate limits. */
export const REQUEST_GAP_MS = 4000
export const REQUEST_TIMEOUT_MS = 60_000
/** Room for ten one-sentence reasons plus any thinking the model does before answering. */
export const MAX_OUTPUT_TOKENS = 8192
