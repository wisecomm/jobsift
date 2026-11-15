import { z } from 'zod'
import type { AiSettings, TokenUsage } from '../shared/types'
import { EXAONE_ENDPOINT, MAX_OUTPUT_TOKENS, REQUEST_TIMEOUT_MS } from './constants'
import {
  badResponseResult,
  classifyHttpError,
  errorDetail,
  errResult,
  networkError,
  nonNegInt,
  readJsonBody,
  validateScoresText,
  type FetchLike,
} from './parseScores'
import { buildPrompt, SYSTEM_INSTRUCTION } from './prompt'
import type { ScoreItem, ScoreResult } from './types'
import { addTokenUsage } from './usage'

const EXAONE_JSON_SUFFIX =
  '\n추론(생각)은 공고당 핵심 키워드 위주로 1줄 이내로 아주 짧게 마치고, 다른 설명이나 마크다운 코드블록 없이 JSON 배열만 응답하세요. 형식: [{"index":0,"score":85,"reason":"..."}]'

const usageSchema = z
  .object({
    prompt_tokens: z.number().nullish(),
    completion_tokens: z.number().nullish(),
    total_tokens: z.number().nullish(),
    reasoning_tokens: z.number().nullish(),
    prompt_tokens_details: z.object({ cached_tokens: z.number().nullish() }).loose().nullish(),
    completion_tokens_details: z.object({ reasoning_tokens: z.number().nullish() }).loose().nullish(),
  })
  .loose()

const chatEnvelopeSchema = z
  .object({
    choices: z
      .array(
        z
          .object({
            finish_reason: z.string().nullish(),
            message: z.object({ content: z.string().nullish(), reasoning_content: z.string().nullish() }).loose().nullish(),
          })
          .loose(),
      )
      .nullish(),
    error: z.object({ message: z.string().nullish() }).loose().nullish(),
    usage: usageSchema.nullish(),
  })
  .loose()

function toTokenUsage(raw: z.infer<typeof usageSchema>): TokenUsage {
  const inputTokens = nonNegInt(raw.prompt_tokens ?? undefined)
  const outputTokens = nonNegInt(raw.completion_tokens ?? undefined)
  const thoughtTokens = nonNegInt((raw.reasoning_tokens ?? raw.completion_tokens_details?.reasoning_tokens) ?? undefined)
  const cachedTokens = nonNegInt(raw.prompt_tokens_details?.cached_tokens ?? undefined)
  const totalTokens = raw.total_tokens != null ? nonNegInt(raw.total_tokens) : inputTokens + outputTokens
  return { inputTokens, outputTokens, thoughtTokens, cachedTokens, totalTokens }
}

const MAX_SHORT_RETRY_WAIT_MS = 10_000
const BUSY_RETRY_WAITS_MS = [3_000, 6_000, 10_000]
const TRANSIENT_RETRY_WAIT_MS = 3_000
const SPLIT_RETRY_MIN_ITEMS = 4

function parseShortRetryMs(response: Response): number | null {
  const msRaw = response.headers.get('retry-after-ms')
  if (msRaw !== null) {
    const ms = Number(msRaw)
    if (Number.isFinite(ms) && ms > 0 && ms <= MAX_SHORT_RETRY_WAIT_MS) return ms + 100
  }
  const secRaw = response.headers.get('retry-after')
  if (secRaw !== null) {
    const sec = Number(secRaw)
    if (Number.isFinite(sec) && sec > 0 && sec * 1000 <= MAX_SHORT_RETRY_WAIT_MS) return sec * 1000 + 100
  }
  return null
}

function hasRemainingQuota(response: Response): boolean {
  let sawHeader = false
  for (const win of ['second', 'minute', 'day'] as const) {
    const rem = response.headers.get(`x-${win}-rate-limit-remaining`)
    if (rem === null) continue
    sawHeader = true
    const n = Number(rem)
    if (!Number.isFinite(n) || n <= 0) return false
  }
  return sawHeader
}

function retryWaitMs(response: Response, attempt: number): number | null {
  const backoff = BUSY_RETRY_WAITS_MS[attempt]
  if (backoff === undefined) return null
  if (response.headers.get('x-day-rate-limit-remaining') === '0') return null
  const hasHint = response.headers.get('retry-after-ms') !== null || response.headers.get('retry-after') !== null
  if (hasHint) return parseShortRetryMs(response)
  return hasRemainingQuota(response) ? backoff : null
}

function sleepAbortable(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

/** The only module that knows EXAONE's OpenAI-compatible Chat Completions request and response shape. */
export async function scoreExaoneBatch(
  settings: AiSettings,
  instruction: string,
  items: readonly ScoreItem[],
  { fetch, signal }: { fetch: FetchLike; signal?: AbortSignal },
): Promise<ScoreResult> {
  const send = (chunk: readonly ScoreItem[]) =>
    fetch(EXAONE_ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      signal: signal ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        Authorization: `Bearer ${settings.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: settings.model,
        messages: [
          { role: 'system', content: `${SYSTEM_INSTRUCTION}${EXAONE_JSON_SUFFIX}` },
          { role: 'user', content: buildPrompt(instruction, chunk) },
        ],
        max_tokens: MAX_OUTPUT_TOKENS,
        temperature: 1.0,
        top_p: 0.95,
        reasoning_effort: 'low',
        stream: false,
      }),
    })

  const sendOnce = async (chunk: readonly ScoreItem[]): Promise<ScoreResult> => {
    let response: Response
    try {
      response = await send(chunk)
      for (let attempt = 0; response.status === 429; attempt++) {
        const waitMs = retryWaitMs(response, attempt)
        if (waitMs === null || signal?.aborted) break
        await sleepAbortable(waitMs, signal)
        if (signal?.aborted) break
        response = await send(chunk)
      }
    } catch (error) {
      return errResult(networkError(error))
    }
    if (!response.ok) return errResult(await classifyHttpError(response, settings))

    const parsedBody = await readJsonBody(response, settings.apiKey)
    if (parsedBody.kind === 'error') return parsedBody
    const envelope = chatEnvelopeSchema.safeParse(parsedBody.body)
    if (!envelope.success) return badResponseResult('응답 형식을 알아볼 수 없습니다')
    if (envelope.data.error?.message) {
      return badResponseResult(`모델이 응답에 실패했습니다 (${errorDetail(envelope.data.error.message, settings.apiKey)})`)
    }
    const firstChoice = envelope.data.choices?.[0]
    if (!firstChoice) return badResponseResult('응답에 choices가 없습니다')
    if (firstChoice.finish_reason === 'length') return errResult({ kind: 'incomplete', status: 'length' })
    const text = firstChoice.message?.content ?? ''
    const usage = envelope.data.usage ? toTokenUsage(envelope.data.usage) : undefined
    return validateScoresText(text, chunk, usage)
  }

  const first = await sendOnce(items)
  const retryable =
    first.kind === 'error' &&
    (first.error.kind === 'network' || first.error.kind === 'server' || first.error.kind === 'badResponse' || first.error.kind === 'incomplete')
  if (!retryable || signal?.aborted) return first

  await sleepAbortable(TRANSIENT_RETRY_WAIT_MS, signal)
  if (signal?.aborted) return first
  if (items.length < SPLIT_RETRY_MIN_ITEMS) return sendOnce(items)

  const mid = Math.ceil(items.length / 2)
  const left = await sendOnce(items.slice(0, mid))
  if (left.kind === 'error' || signal?.aborted) return left
  await sleepAbortable(TRANSIENT_RETRY_WAIT_MS, signal)
  if (signal?.aborted) return first
  const right = await sendOnce(items.slice(mid))
  if (right.kind === 'error') return right

  const scores = [...left.scores, ...right.scores].sort((a, b) => a.index - b.index)
  const usage = left.usage && right.usage ? addTokenUsage(left.usage, right.usage) : (left.usage ?? right.usage)
  return usage ? { kind: 'ok', scores, usage } : { kind: 'ok', scores }
}
