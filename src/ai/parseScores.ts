import { z } from 'zod'
import type { AiProvider, AiSettings, TokenUsage } from '../shared/types'
import { REQUEST_TIMEOUT_MS } from './constants'
import type { AiError, PostingScore, ScoreItem, ScoreResult } from './types'

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

const scoresSchema = z.array(
  z.object({ index: z.number().int(), score: z.number().int().min(0).max(100), reason: z.string() }),
)

export const errResult = (error: AiError): ScoreResult => ({ kind: 'error', error })
export const badResponseResult = (detail: string): ScoreResult => errResult({ kind: 'badResponse', detail })
export const nonNegInt = (n: number | undefined): number =>
  typeof n === 'number' && Number.isFinite(n) && n > 0 ? Math.round(n) : 0

/** Strips key material from raw HTTP error text before displaying or storing it. */
export function errorDetail(body: string, key: string): string {
  let detail = body.trim()
  try {
    const json: unknown = JSON.parse(body)
    const message = json as { error?: { message?: unknown }; message?: unknown; description?: unknown } | null
    const found = message?.error?.message ?? message?.description ?? message?.message
    if (typeof found === 'string') detail = found
    else if (typeof json === 'object' && json !== null && !Array.isArray(json) && Object.keys(json).length === 0) {
      detail = ''
    }
  } catch {
    // not JSON; the raw text stands
  }
  return (key ? detail.replaceAll(key, '***') : detail).slice(0, 300)
}

function rateLimitDetail(response: Response, body: string, key: string): string {
  const parts: string[] = []
  const windows: Array<[string, string]> = [
    ['second', '초당'],
    ['minute', '분당'],
    ['day', '일일'],
  ]
  for (const [win, label] of windows) {
    const rem = response.headers.get(`x-${win}-rate-limit-remaining`)
    const max = response.headers.get(`x-${win}-rate-limit`)
    if (rem !== null && max !== null) parts.push(`${label} ${rem}/${max}`)
    else if (rem !== null) parts.push(`${label} 잔여 ${rem}`)
  }
  const retryMs = response.headers.get('retry-after-ms')
  const retrySec = response.headers.get('retry-after')
  if (retrySec !== null) parts.push(`대기 ${retrySec}초`)
  else if (retryMs !== null) parts.push(`대기 ${Math.ceil(Number(retryMs) / 1000)}초`)

  const msg = errorDetail(body, key)
  if (msg) parts.push(msg)
  return parts.join(' · ').slice(0, 300)
}

export async function classifyHttpError(response: Response, settings: AiSettings): Promise<AiError> {
  const { status } = response
  if (status === 401 || status === 403) return { kind: 'invalidKey' }
  if (status === 404) return { kind: 'unknownModel', model: settings.model }
  const bodyText = await response.text().catch(() => '')
  if (status === 429) {
    const detail = rateLimitDetail(response, bodyText, settings.apiKey)
    return detail ? { kind: 'rateLimited', detail } : { kind: 'rateLimited' }
  }
  if (status >= 500) return { kind: 'server', status }
  const detail = errorDetail(bodyText, settings.apiKey)
  return status >= 400 ? { kind: 'badRequest', status, detail } : { kind: 'badResponse', detail: `예상하지 못한 응답 코드 ${status}` }
}

export function networkError(error: unknown): AiError {
  if (error instanceof DOMException && error.name === 'TimeoutError') {
    return { kind: 'network', detail: `${Math.round(REQUEST_TIMEOUT_MS / 1000)}초 응답 시간 초과` }
  }
  return { kind: 'network' }
}

/** Reads an OK response body as JSON, distinguishing stream/network aborts from non-JSON payloads. */
export async function readJsonBody(
  response: Response,
  key: string,
): Promise<{ kind: 'ok'; body: unknown } | { kind: 'error'; error: AiError }> {
  let text: string
  try {
    text = await response.text()
  } catch (error) {
    return { kind: 'error', error: networkError(error) }
  }
  try {
    return { kind: 'ok', body: JSON.parse(text) }
  } catch {
    const preview = errorDetail(text, key).replace(/\s+/g, ' ').slice(0, 120)
    const detail = preview ? `응답이 JSON이 아닙니다 (${preview})` : '응답이 JSON이 아닙니다 (빈 응답)'
    return { kind: 'error', error: { kind: 'badResponse', detail } }
  }
}

function repairJsonReasons(text: string): string {
  return text
    .replace(/"reason"\s*:\s*":\s*"/g, '"reason":"')
    .replace(
      /("reason"\s*:\s*")([\s\S]*?)("(?=\s*(?:\}\s*(?:,|\]|$)|,\s*"(?:index|score)"\s*:)))/g,
      (_match, prefix: string, body: string, suffix: string) => {
        const cleaned = body.replace(/^:\s*"/, '').replace(/\\?"/g, '\\"')
        return `${prefix}${cleaned}${suffix}`
      },
    )
    .replace(/,\s*([}\]])/g, '$1')
}

function tryParseJson(candidate: string): unknown | undefined {
  for (const text of [candidate, repairJsonReasons(candidate)]) {
    try {
      return JSON.parse(text)
    } catch {
      // try repaired variant
    }
  }
  return undefined
}

function unwrapArray(value: unknown): unknown {
  if (Array.isArray(value) || typeof value !== 'object' || value === null) return value
  const arrays = Object.values(value as Record<string, unknown>).filter(Array.isArray)
  return arrays.length === 1 ? arrays[0] : value
}

/** Finds a balanced `[...]` JSON array inside surrounding prose, ignoring brackets inside strings. */
function findBalancedJsonArray(text: string): unknown | undefined {
  let depth = 0
  let start = -1
  let inString = false
  let escaped = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '[') {
      if (depth === 0) start = i
      depth++
    } else if (ch === ']' && depth > 0) {
      depth--
      if (depth === 0 && start >= 0) {
        const parsed = tryParseJson(text.slice(start, i + 1))
        if (Array.isArray(parsed)) return parsed
        start = -1
      }
    }
  }
  return undefined
}

/** Extracts a JSON array even if a model wraps it in markdown code fences, prose with brackets, or trailing commas. */
function parseJsonText(rawText: string): unknown {
  const trimmed = rawText.trim()
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const primary = (fencedMatch?.[1] ?? trimmed).trim()

  const direct = tryParseJson(primary)
  if (direct !== undefined) return unwrapArray(direct)

  const extracted =
    findBalancedJsonArray(primary) ??
    findBalancedJsonArray(repairJsonReasons(primary)) ??
    (primary !== trimmed ? (findBalancedJsonArray(trimmed) ?? findBalancedJsonArray(repairJsonReasons(trimmed))) : undefined)
  if (extracted !== undefined) return extracted
  throw new SyntaxError('Invalid JSON')
}

export function validateScoresText(text: string, items: readonly ScoreItem[], usage?: TokenUsage): ScoreResult {
  if (text.trim() === '') return badResponseResult('응답에 텍스트가 없습니다')

  let json: unknown
  try {
    json = parseJsonText(text)
  } catch {
    const preview = text.trim().replace(/\s+/g, ' ').slice(0, 100)
    return badResponseResult(`응답이 올바른 JSON이 아닙니다 (${preview})`)
  }
  const parsed = scoresSchema.safeParse(json)
  if (!parsed.success) return badResponseResult('응답의 점수 형식이 맞지 않습니다 (점수는 0~100 정수여야 합니다)')

  const scores: PostingScore[] = [...parsed.data].sort((a, b) => a.index - b.index)
  const wanted = items.map((item) => item.index).sort((a, b) => a - b)
  if (scores.length !== wanted.length) return badResponseResult(`공고 ${wanted.length}건을 보냈는데 점수가 ${scores.length}건 돌아왔습니다`)
  const exactMatch = scores.every((score, i) => score.index === wanted[i])
  const zeroBasedMatch = scores.every((score, i) => score.index === i)
  if (!exactMatch && !zeroBasedMatch) return badResponseResult('응답의 번호가 보낸 공고와 맞지 않습니다')
  const normalized = exactMatch ? scores : scores.map((score, i) => ({ ...score, index: wanted[i]! }))
  return usage ? { kind: 'ok', scores: normalized, usage } : { kind: 'ok', scores: normalized }
}

export function formatAiError(error: AiError, provider: AiProvider = 'gemini'): string {
  const host = provider === 'exaone' ? 'EXAONE' : 'Google'
  const consoleName = provider === 'exaone' ? 'EXAONE API Platform' : 'Google AI Studio'
  switch (error.kind) {
    case 'invalidKey':
      return `API 키가 거부되었습니다. 키를 다시 확인하고, ${consoleName}에서 쓸 수 있는 키인지 확인해 주세요.`
    case 'rateLimited': {
      const detail = error.detail ? ` (${error.detail})` : ''
      if (error.detail && /busy|concurrent/i.test(error.detail)) {
        return `${host} 서버가 일시적으로 혼잡합니다${detail}. 잠시 뒤에 "대기 공고 채점"을 다시 눌러 주세요.`
      }
      return `요청 한도에 걸렸습니다${detail}. 잠시 뒤에 "대기 공고 채점"을 다시 눌러 주세요. 계속되면 내 키의 사용량 한도를 확인해 주세요.`
    }
    case 'unknownModel':
      return `모델 "${error.model}"을 찾을 수 없습니다. AI 채점 설정의 모델 이름을 확인해 주세요.`
    case 'badRequest':
      return `요청이 거부되었습니다 (${error.status}). 모델 이름과 키를 확인해 주세요.${error.detail ? ` ${host}의 설명: ${error.detail}` : ''}`
    case 'badResponse':
      return `AI 응답을 읽지 못했습니다. ${error.detail}. 같은 문제가 반복되면 모델 이름을 바꿔 보세요.`
    case 'network':
      return error.detail
        ? `${host} 서버 응답이 지연되어 멈췄습니다 (${error.detail}). 잠시 뒤에 다시 시도해 주세요.`
        : `${host} 서버에 연결하지 못했습니다. 인터넷 연결을 확인하고 다시 시도해 주세요.`
    case 'server':
      return `${host} 서버에 문제가 있습니다 (${error.status}). 잠시 뒤에 다시 시도해 주세요.`
    case 'incomplete':
      return `AI 응답이 끝나지 않았습니다 (상태: ${error.status}). 잠시 뒤에 다시 시도해 주세요.`
  }
}
