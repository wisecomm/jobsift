import { z } from 'zod'
import type { AiSettings } from '../shared/types'
import { GEMINI_API_REVISION, GEMINI_ENDPOINT, MAX_OUTPUT_TOKENS, REQUEST_TIMEOUT_MS } from './constants'
import { buildPrompt, SYSTEM_INSTRUCTION } from './prompt'
import type { AiError, PostingScore, ScoreItem, ScoreResult } from './types'

type FetchLike = (url: string, init: RequestInit) => Promise<Response>

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

const envelopeSchema = z.object({
  status: z.string(),
  steps: z.array(z.object({ type: z.string() }).loose()).default([]),
  errors: z.array(z.object({ code: z.unknown(), message: z.string().optional() }).loose()).optional(),
})

const modelOutputSchema = z.object({
  content: z.array(z.object({ type: z.string(), text: z.string().optional() }).loose()).default([]),
})

const scoresSchema = z.array(
  z.object({ index: z.number().int(), score: z.number().int().min(0).max(100), reason: z.string() }),
)

const err = (error: AiError): ScoreResult => ({ kind: 'error', error })
const badResponse = (detail: string) => err({ kind: 'badResponse', detail })

/** Google's error body shape is undocumented, so take a message if one is plainly there and otherwise the raw text. */
function errorDetail(body: string, key: string): string {
  let detail = body.trim()
  try {
    const json: unknown = JSON.parse(body)
    const message = (json as { error?: { message?: unknown }; message?: unknown } | null)
    const found = message?.error?.message ?? message?.message
    if (typeof found === 'string') detail = found
  } catch {
    // not JSON; the raw text stands
  }
  return detail.replaceAll(key, '***').slice(0, 300)
}

async function classifyHttpError(response: Response, settings: AiSettings): Promise<AiError> {
  const { status } = response
  if (status === 401 || status === 403) return { kind: 'invalidKey' }
  if (status === 404) return { kind: 'unknownModel', model: settings.model }
  if (status === 429) return { kind: 'rateLimited' }
  if (status >= 500) return { kind: 'server', status }
  const detail = errorDetail(await response.text().catch(() => ''), settings.apiKey)
  return status >= 400 ? { kind: 'badRequest', status, detail } : { kind: 'badResponse', detail: `예상하지 못한 응답 코드 ${status}` }
}

function readScores(envelope: z.infer<typeof envelopeSchema>, items: readonly ScoreItem[], key: string): ScoreResult {
  if (envelope.status === 'failed') {
    const message = envelope.errors?.map((e) => e.message).filter(Boolean).join(' ') ?? ''
    return badResponse(message ? `모델이 응답에 실패했습니다 (${errorDetail(message, key)})` : '모델이 응답에 실패했습니다')
  }
  if (envelope.status !== 'completed') return err({ kind: 'incomplete', status: envelope.status })

  const text = envelope.steps
    .filter((step) => step.type === 'model_output')
    .flatMap((step) => {
      const parsed = modelOutputSchema.safeParse(step)
      return parsed.success ? parsed.data.content : []
    })
    .filter((part) => part.type === 'text')
    .map((part) => part.text ?? '')
    .join('')
  if (text.trim() === '') return badResponse('응답에 텍스트가 없습니다')

  let json: unknown
  try {
    json = JSON.parse(text)
  } catch {
    return badResponse('응답이 올바른 JSON이 아닙니다')
  }
  const parsed = scoresSchema.safeParse(json)
  if (!parsed.success) return badResponse('응답의 점수 형식이 맞지 않습니다 (점수는 0~100 정수여야 합니다)')

  const scores: PostingScore[] = [...parsed.data].sort((a, b) => a.index - b.index)
  const wanted = items.map((item) => item.index).sort((a, b) => a - b)
  if (scores.length !== wanted.length) return badResponse(`공고 ${wanted.length}건을 보냈는데 점수가 ${scores.length}건 돌아왔습니다`)
  if (scores.some((score, i) => score.index !== wanted[i])) return badResponse('응답의 번호가 보낸 공고와 맞지 않습니다')
  return { kind: 'ok', scores }
}

/** The only module that knows Gemini's request and response shape. */
export async function scoreBatch(
  settings: AiSettings,
  instruction: string,
  items: readonly ScoreItem[],
  { fetch }: { fetch: FetchLike },
): Promise<ScoreResult> {
  let response: Response
  try {
    response = await fetch(GEMINI_ENDPOINT, {
      method: 'POST',
      credentials: 'omit',
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
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
  } catch {
    return err({ kind: 'network' })
  }
  if (!response.ok) return err(await classifyHttpError(response, settings))

  let body: unknown
  try {
    body = await response.json()
  } catch {
    return badResponse('응답이 JSON이 아닙니다')
  }
  const envelope = envelopeSchema.safeParse(body)
  if (!envelope.success) return badResponse('응답 형식을 알아볼 수 없습니다')
  return readScores(envelope.data, items, settings.apiKey)
}

/** One tiny request through the same path as real scoring, so a pass here means scoring will work. */
export function checkKey(settings: AiSettings, { fetch }: { fetch: FetchLike }): Promise<ScoreResult> {
  const probe: ScoreItem = { index: 0, title: '사무 보조', company: '테스트', jobTags: [], career: '경력무관', locations: [] }
  return scoreBatch(settings, '사무직을 찾고 있습니다.', [probe], { fetch })
}

export function aiErrorMessage(error: AiError): string {
  switch (error.kind) {
    case 'invalidKey':
      return 'API 키가 거부되었습니다. 키를 다시 확인하고, Google AI Studio에서 쓸 수 있는 키인지 확인해 주세요.'
    case 'rateLimited':
      return '요청 한도에 걸렸습니다. 잠시 뒤에 "대기 공고 채점"을 다시 눌러 주세요. 계속되면 내 키의 사용량 한도를 확인해 주세요.'
    case 'unknownModel':
      return `모델 "${error.model}"을 찾을 수 없습니다. AI 채점 설정의 모델 이름을 확인해 주세요.`
    case 'badRequest':
      return `요청이 거부되었습니다 (${error.status}). 모델 이름과 키를 확인해 주세요.${error.detail ? ` Google의 설명: ${error.detail}` : ''}`
    case 'badResponse':
      return `AI 응답을 읽지 못했습니다. ${error.detail}. 같은 문제가 반복되면 모델 이름을 바꿔 보세요.`
    case 'network':
      return 'Google 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.'
    case 'server':
      return `Google 서버에 문제가 있습니다 (${error.status}). 잠시 뒤에 다시 시도해 주세요.`
    case 'incomplete':
      return `AI 응답이 끝나지 않았습니다 (상태: ${error.status}). 잠시 뒤에 다시 시도해 주세요.`
  }
}
