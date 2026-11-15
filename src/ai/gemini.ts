import { z } from 'zod'
import type { AiSettings, TokenUsage } from '../shared/types'
import { GEMINI_API_REVISION, GEMINI_ENDPOINT, MAX_OUTPUT_TOKENS, REQUEST_TIMEOUT_MS } from './constants'
import {
  badResponseResult,
  classifyHttpError,
  errorDetail,
  errResult,
  formatAiError,
  networkError,
  nonNegInt,
  readJsonBody,
  validateScoresText,
  type FetchLike,
} from './parseScores'
import { buildPrompt, SYSTEM_INSTRUCTION } from './prompt'
import type { AiError, ScoreItem, ScoreResult } from './types'

const RESPONSE_SCHEMA = {
  type: 'array',
  items: {
    type: 'object',
    properties: {
      index: { type: 'integer' },
      score: { type: 'integer', minimum: 0, maximum: 100 },
      reason: { type: 'string' },
    },
    required: ['index', 'score', 'reason'],
  },
} as const

const rawUsageSchema = z
  .object({
    total_input_tokens: z.number().optional(),
    total_output_tokens: z.number().optional(),
    total_thought_tokens: z.number().optional(),
    total_cached_tokens: z.number().optional(),
    total_tokens: z.number().optional(),
  })
  .loose()

const envelopeSchema = z.object({
  status: z.string(),
  steps: z.array(z.object({ type: z.string() }).loose()).default([]),
  errors: z.array(z.object({ code: z.unknown(), message: z.string().optional() }).loose()).optional(),
  usage: rawUsageSchema.optional(),
})

function toTokenUsage(raw: z.infer<typeof rawUsageSchema>): TokenUsage {
  const inputTokens = nonNegInt(raw.total_input_tokens)
  const outputTokens = nonNegInt(raw.total_output_tokens)
  const thoughtTokens = nonNegInt(raw.total_thought_tokens)
  const cachedTokens = nonNegInt(raw.total_cached_tokens)
  const totalTokens = raw.total_tokens !== undefined ? nonNegInt(raw.total_tokens) : inputTokens + outputTokens + thoughtTokens
  return { inputTokens, outputTokens, thoughtTokens, cachedTokens, totalTokens }
}

const modelOutputSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()).default([]),
})

function readScores(envelope: z.infer<typeof envelopeSchema>, items: readonly ScoreItem[], key: string): ScoreResult {
  if (envelope.status === 'failed') {
    const message = envelope.errors?.map((e) => e.message).filter(Boolean).join(' ') ?? ''
    return badResponseResult(message ? `모델이 응답에 실패했습니다 (${errorDetail(message, key)})` : '모델이 응답에 실패했습니다')
  }
  if (envelope.status !== 'completed') return errResult({ kind: 'incomplete', status: envelope.status })

  const text = envelope.steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => {
      const parsed = modelOutputSchema.safeParse(step)
      return parsed.success ? parsed.data.content : []
    })
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')

  const usage = envelope.usage ? toTokenUsage(envelope.usage) : undefined
  return validateScoresText(text, items, usage)
}

/** The only module that knows Gemini's request and response shape. */
export async function scoreBatch(
  settings: AiSettings,
  instruction: string,
  items: readonly ScoreItem[],
  { fetch, signal }: { fetch: FetchLike; signal?: AbortSignal },
): Promise<ScoreResult> {
  let response: Response
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      signal: signal ? AbortSignal.any([AbortSignal.timeout(REQUEST_TIMEOUT_MS), signal]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        'x-goog-api-key': settings.apiKey,
        'Content-Type': 'application/json',
        'Api-Revision': GEMINI_API_REVISION,
      },
      body: JSON.stringify({
        model: settings.model,
        input: buildPrompt(instruction, items),
        system_instruction: SYSTEM_INSTRUCTION,
        store: false,
        generation_config: { max_output_tokens: MAX_OUTPUT_TOKENS },
        response_format: { type: 'text', mime_type: 'application/json', schema: RESPONSE_SCHEMA },
      }),
    })
  } catch (error) {
    return errResult(networkError(error))
  }
  if (!response.ok) return errResult(await classifyHttpError(response, settings))

  const parsedBody = await readJsonBody(response, settings.apiKey)
  if (parsedBody.kind === 'error') return parsedBody
  const envelope = envelopeSchema.safeParse(parsedBody.body)
  if (!envelope.success) return badResponseResult('응답 형식을 알아볼 수 없습니다')
  return readScores(envelope.data, items, settings.apiKey)
}

/** One tiny request through the same path as real scoring, so a pass here means scoring will work. */
export function checkKey(settings: AiSettings, { fetch }: { fetch: FetchLike }): Promise<ScoreResult> {
  const probe: ScoreItem = { index: 0, title: '사무 보조', company: '테스트', jobTags: [], career: '경력무관', locations: [] }
  return scoreBatch(settings, '사무직을 찾고 있습니다.', [probe], { fetch })
}

export const aiErrorMessage = (error: AiError): string => formatAiError(error, 'gemini')
