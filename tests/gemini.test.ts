import { describe, expect, it } from 'vitest'
import { aiErrorMessage, checkKey, scoreBatch } from '../src/ai/gemini'
import type { AiError, ScoreItem } from '../src/ai/types'

const KEY = 'fake-key-for-local-test'
const settings = { apiKey: KEY, model: 'gemini-3.5-flash-lite', minScore: 60 }
const items: ScoreItem[] = [0, 1, 2].map((index) => ({ index, title: `공고 ${index}`, company: '회사', jobTags: [], career: '경력무관', locations: [] }))
const goodScores = [0, 1, 2].map((index) => ({ index, score: 50 + index, reason: `이유 ${index}` }))

interface Seen { url: string; init: RequestInit; body: Record<string, any> }

function fake(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = []
  const fetch = async (url: string, init: RequestInit) => {
    seen.push({ url, init, body: JSON.parse(String(init.body)) })
    return respond()
  }
  return { seen, fetch }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })
const completed = (text: string, extraSteps: unknown[] = []) =>
  json({
    id: 'x',
    status: 'completed',
    steps: [...extraSteps, { type: 'model_output', content: [{ type: 'text', text }] }],
    usage: { total_tokens: 1 },
  })

const run = (respond: () => Response | Promise<Response>) => {
  const f = fake(respond)
  return { ...f, result: scoreBatch(settings, '전산을 원합니다', items, { fetch: f.fetch }) }
}

describe('scoreBatch request', () => {
  it('posts to the interactions endpoint with the three headers and a stateless JSON-schema body', async () => {
    const { seen, result } = run(() => completed(JSON.stringify(goodScores)))
    await result
    const [call] = seen
    expect(call?.url).toBe('https://generativelanguage.googleapis.com/v1beta/interactions')
    expect(call?.init.method).toBe('POST')
    expect(call?.init.headers).toEqual({ 'x-goog-api-key': KEY, 'Content-Type': 'application/json', 'Api-Revision': '2026-05-20' })
    expect(call?.body).toMatchObject({
      model: 'gemini-3.5-flash-lite',
      store: false,
      response_format: { type: 'text', mime_type: 'application/json', schema: { type: 'array' } },
    })
    expect(typeof call?.body.system_instruction).toBe('string')
    expect(call?.body.input).toContain('전산을 원합니다')
    expect(call?.body.input).toContain('공고 2')
    expect(call?.body.generation_config.max_output_tokens).toBeGreaterThan(0)
  })

  it('never puts the key in the body', async () => {
    const { seen, result } = run(() => completed(JSON.stringify(goodScores)))
    await result
    expect(JSON.stringify(seen[0]?.body)).not.toContain(KEY)
  })
})

describe('scoreBatch response', () => {
  it('reads the text from a model_output step among other step types', async () => {
    const other = [{ type: 'thought', summary: 'hmm' }, { type: 'user_input', content: 'x' }]
    const { result } = run(() => completed(JSON.stringify([...goodScores].reverse()), other))
    expect(await result).toEqual({ kind: 'ok', scores: goodScores })
  })

  it('joins several text parts of the output', async () => {
    const text = JSON.stringify(goodScores)
    const { result } = run(() =>
      json({ status: 'completed', steps: [{ type: 'model_output', content: [{ type: 'text', text: text.slice(0, 10) }, { type: 'text', text: text.slice(10) }] }] }),
    )
    expect((await result).kind).toBe('ok')
  })

  const errorOf = async (respond: () => Response | Promise<Response>): Promise<AiError> => {
    const result = await run(respond).result
    if (result.kind !== 'error') throw new Error('expected an error')
    return result.error
  }

  it.each([
    [401, { kind: 'invalidKey' }],
    [403, { kind: 'invalidKey' }],
    [404, { kind: 'unknownModel', model: 'gemini-3.5-flash-lite' }],
    [429, { kind: 'rateLimited' }],
    [500, { kind: 'server', status: 500 }],
    [503, { kind: 'server', status: 503 }],
  ])('maps HTTP %i to its error', async (status, expected) => {
    expect(await errorOf(() => new Response('', { status }))).toEqual(expected)
  })

  it('maps 400 to badRequest and carries whatever message the body has', async () => {
    const withMessage = await errorOf(() => json({ error: { message: `bad field, key ${KEY}` } }, 400))
    expect(withMessage).toEqual({ kind: 'badRequest', status: 400, detail: 'bad field, key ***' })
    const plain = await errorOf(() => new Response('nope', { status: 400 }))
    expect(plain).toMatchObject({ kind: 'badRequest', detail: 'nope' })
    const empty = await errorOf(() => new Response('', { status: 400 }))
    expect(empty).toMatchObject({ kind: 'badRequest', detail: '' })
  })

  it('maps a thrown fetch to network', async () => {
    expect(await errorOf(() => Promise.reject(new TypeError('Failed to fetch')))).toEqual({ kind: 'network' })
  })

  it('maps status failed to badResponse with the model error text', async () => {
    const error = await errorOf(() => json({ status: 'failed', steps: [], errors: [{ code: 'x', message: '안전 필터' }] }))
    expect(error).toMatchObject({ kind: 'badResponse' })
    expect(JSON.stringify(error)).toContain('안전 필터')
  })

  it.each(['incomplete', 'requires_continuation', 'in_progress'])('maps status %s to incomplete', async (status) => {
    expect(await errorOf(() => json({ status, steps: [] }))).toEqual({ kind: 'incomplete', status })
  })

  it('rejects malformed JSON text, a wrong item count, a wrong index and an out-of-range score', async () => {
    const bad = (text: string) => errorOf(() => completed(text))
    expect((await bad('{not json')).kind).toBe('badResponse')
    expect((await bad(JSON.stringify(goodScores.slice(0, 2)))).kind).toBe('badResponse')
    expect((await bad(JSON.stringify([...goodScores, { index: 3, score: 1, reason: 'x' }]))).kind).toBe('badResponse')
    expect((await bad(JSON.stringify([{ index: 0, score: 1, reason: 'a' }, { index: 1, score: 1, reason: 'a' }, { index: 7, score: 1, reason: 'a' }]))).kind).toBe('badResponse')
    expect((await bad(JSON.stringify([{ index: 0, score: 1, reason: 'a' }, { index: 0, score: 1, reason: 'a' }, { index: 1, score: 1, reason: 'a' }]))).kind).toBe('badResponse')
    for (const score of [101, -1, 50.5, '80']) {
      expect((await bad(JSON.stringify(goodScores.map((s, i) => (i === 0 ? { ...s, score } : s))))).kind).toBe('badResponse')
    }
  })

  it('rejects a body that is not JSON, has no steps text, or the wrong envelope', async () => {
    expect((await errorOf(() => new Response('<html>', { status: 200 }))).kind).toBe('badResponse')
    expect((await errorOf(() => json({ status: 'completed', steps: [{ type: 'thought' }] }))).kind).toBe('badResponse')
    expect((await errorOf(() => json({ nothing: true }))).kind).toBe('badResponse')
  })
})

describe('checkKey', () => {
  it('sends one request for one tiny item', async () => {
    const f = fake(() => completed(JSON.stringify([{ index: 0, score: 70, reason: '맞음' }])))
    const result = await checkKey(settings, { fetch: f.fetch })
    expect(result.kind).toBe('ok')
    expect(f.seen).toHaveLength(1)
  })
})

describe('aiErrorMessage', () => {
  const kinds: AiError[] = [
    { kind: 'invalidKey' },
    { kind: 'rateLimited' },
    { kind: 'unknownModel', model: 'm-1' },
    { kind: 'badRequest', status: 400, detail: '세부' },
    { kind: 'badResponse', detail: '세부' },
    { kind: 'network' },
    { kind: 'server', status: 502 },
    { kind: 'incomplete', status: 'incomplete' },
  ]

  it('gives each kind its own Korean message and never the key', () => {
    const messages = kinds.map(aiErrorMessage)
    expect(new Set(messages).size).toBe(kinds.length)
    for (const message of messages) {
      expect(message).toMatch(/[가-힣]/)
      expect(message).not.toContain(KEY)
    }
    expect(aiErrorMessage({ kind: 'unknownModel', model: 'm-1' })).toContain('m-1')
  })
})
