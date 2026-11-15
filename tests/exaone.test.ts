import { describe, expect, it, vi } from 'vitest'
import { EXAONE_ENDPOINT } from '../src/ai/constants'
import { scoreExaoneBatch } from '../src/ai/exaone'
import { formatAiError } from '../src/ai/parseScores'
import { checkProviderKey, scoreWithProvider } from '../src/ai/provider'
import type { ScoreItem } from '../src/ai/types'
import type { AiSettings } from '../src/shared/types'

const KEY = 'exaone-test-key'
const settings: AiSettings = {
  provider: 'exaone',
  apiKey: KEY,
  model: 'k-exaone_v2.5',
  minScore: 60,
}
const items: ScoreItem[] = [0, 1].map((index) => ({
  index,
  title: `전산 공고 ${index}`,
  company: '기관',
  jobTags: ['전산'],
  career: '경력무관',
  locations: ['서울'],
}))
const goodScores = [
  { index: 0, score: 85, reason: '적합' },
  { index: 1, score: 40, reason: '부적합' },
]

interface Seen {
  url: string
  init: RequestInit
  body: Record<string, any>
}

function fake(respond: () => Response | Promise<Response>) {
  const seen: Seen[] = []
  const fetch = async (url: string, init: RequestInit) => {
    seen.push({ url, init, body: JSON.parse(String(init.body)) })
    return respond()
  }
  return { seen, fetch }
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status })

describe('scoreExaoneBatch and provider dispatch', () => {
  it('posts Bearer auth and OpenAI chat/completions payload to api.exaone.ai', async () => {
    const { seen, fetch } = fake(() =>
      json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(goodScores) } }],
        usage: {
          prompt_tokens: 300,
          completion_tokens: 120,
          total_tokens: 420,
          prompt_tokens_details: { cached_tokens: 20 },
          completion_tokens_details: { reasoning_tokens: 30 },
        },
      }),
    )

    const result = await scoreWithProvider(settings, '전산 직무를 찾습니다.', items, { fetch })
    expect(seen).toHaveLength(1)
    expect(seen[0]?.url).toBe(EXAONE_ENDPOINT)
    expect(seen[0]?.init.headers).toEqual({
      Authorization: `Bearer ${KEY}`,
      'Content-Type': 'application/json',
    })
    expect(seen[0]?.body.model).toBe('k-exaone_v2.5')
    expect(seen[0]?.body.messages).toHaveLength(2)
    expect(JSON.stringify(seen[0]?.body)).not.toContain(KEY)
    expect(result).toEqual({
      kind: 'ok',
      scores: goodScores,
      usage: { inputTokens: 300, outputTokens: 120, thoughtTokens: 30, cachedTokens: 20, totalTokens: 420 },
    })
  })

  it('extracts JSON wrapped in markdown code fences and accepts EXAONE official envelope with null details and top-level reasoning_tokens', async () => {
    const { fetch } = fake(() =>
      json({
        id: '1f30a3635ebd4e4cb57e4d41e2f18d55',
        object: 'chat.completion',
        created: 1793945790,
        model: 'k-exaone_v2.5',
        choices: [
          {
            finish_reason: 'stop',
            index: 0,
            logprobs: null,
            message: {
              role: 'assistant',
              content: `\n\n\`\`\`json\n${JSON.stringify(goodScores)}\n\`\`\``,
              refusal: null,
              annotations: null,
              audio: null,
              function_call: null,
              tool_calls: null,
            },
            matched_stop: 53,
          },
        ],
        metadata: { weight_version: 'default' },
        moderation: null,
        service_tier: null,
        system_fingerprint: null,
        usage: {
          completion_tokens: 218,
          prompt_tokens: 22,
          total_tokens: 240,
          completion_tokens_details: null,
          prompt_tokens_details: null,
          reasoning_tokens: 209,
        },
      }),
    )
    const result = await scoreExaoneBatch(settings, '전산 직무', items, { fetch })
    expect(result).toEqual({
      kind: 'ok',
      scores: goodScores,
      usage: { inputTokens: 22, outputTokens: 218, thoughtTokens: 209, cachedTokens: 0, totalTokens: 240 },
    })
  })

  it('maps 401/429/length errors and formats provider-specific error messages', async () => {
    const unauthorized = fake(() => json({ error: { message: 'bad key' } }, 401))
    expect(await checkProviderKey(settings, { fetch: unauthorized.fetch })).toEqual({
      kind: 'error',
      error: { kind: 'invalidKey' },
    })

    const limited = fake(() => json({}, 429))
    expect(await scoreExaoneBatch(settings, 'x', items, { fetch: limited.fetch })).toEqual({
      kind: 'error',
      error: { kind: 'rateLimited' },
    })

    const truncated = fake(() =>
      json({ choices: [{ finish_reason: 'length', message: { content: '[{"index":0' } }] }),
    )
    expect(await scoreExaoneBatch(settings, 'x', items, { fetch: truncated.fetch })).toEqual({
      kind: 'error',
      error: { kind: 'incomplete', status: 'length' },
    })

    expect(formatAiError({ kind: 'invalidKey' }, 'exaone')).toContain('EXAONE API Platform')
    expect(formatAiError({ kind: 'network' }, 'exaone')).toContain('EXAONE')
  })

  it('retries once on short EXAONE 429 throttle and surfaces header/body details otherwise', async () => {
    let calls = 0
    const retryOk = fake(() => {
      calls++
      if (calls === 1) {
        return new Response(JSON.stringify({ description: 'Too many requests' }), {
          status: 429,
          headers: {
            'x-second-rate-limit': '1',
            'x-second-rate-limit-remaining': '0',
            'retry-after-ms': '10',
          },
        })
      }
      return json({
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(goodScores) } }],
      })
    })
    const okAfterWait = await scoreExaoneBatch(settings, '전산 직무', items, { fetch: retryOk.fetch })
    expect(okAfterWait.kind).toBe('ok')
    expect(calls).toBe(2)

    let dayCalls = 0
    const dayExhausted = fake(() => {
      dayCalls++
      return new Response(JSON.stringify({ description: 'Daily quota exceeded' }), {
        status: 429,
        headers: {
          'x-day-rate-limit': '50',
          'x-day-rate-limit-remaining': '0',
          'retry-after': '1',
        },
      })
    })
    const dayErr = await scoreExaoneBatch(settings, '전산 직무', items, { fetch: dayExhausted.fetch })
    expect(dayCalls).toBe(1)
    expect(dayErr).toEqual({
      kind: 'error',
      error: { kind: 'rateLimited', detail: '일일 0/50 · 대기 1초 · Daily quota exceeded' },
    })
    if (dayErr.kind === 'error') {
      expect(formatAiError(dayErr.error, 'exaone')).toContain('일일 0/50 · 대기 1초 · Daily quota exceeded')
    }

    let plainCalls = 0
    const noRetry = fake(() => {
      plainCalls++
      return new Response(JSON.stringify({ description: 'Rate limit exceeded' }), {
        status: 429,
        headers: { 'x-minute-rate-limit': '10', 'x-minute-rate-limit-remaining': '0' },
      })
    })
    const plainErr = await scoreExaoneBatch(settings, '전산 직무', items, { fetch: noRetry.fetch })
    expect(plainCalls).toBe(1)
    expect(plainErr).toEqual({
      kind: 'error',
      error: { kind: 'rateLimited', detail: '분당 0/10 · Rate limit exceeded' },
    })
  })

  it('backs off and retries when EXAONE returns 429 busy despite remaining quota', async () => {
    vi.useFakeTimers()
    try {
      const busyHeaders = {
        'x-second-rate-limit': '1',
        'x-second-rate-limit-remaining': '1',
        'x-minute-rate-limit': '60',
        'x-minute-rate-limit-remaining': '60',
        'x-day-rate-limit': '86400',
        'x-day-rate-limit-remaining': '86394',
      }

      let recoverCalls = 0
      const recovers = fake(() => {
        recoverCalls++
        if (recoverCalls <= 2) {
          return new Response(JSON.stringify({ description: 'service is busy, too many concurrent requests(600)' }), {
            status: 429,
            headers: busyHeaders,
          })
        }
        return json({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(goodScores) } }],
        })
      })
      const recoverPromise = scoreExaoneBatch(settings, '전산 직무', items, { fetch: recovers.fetch })
      await vi.advanceTimersByTimeAsync(9_000)
      const ok = await recoverPromise
      expect(recoverCalls).toBe(3)
      expect(ok.kind).toBe('ok')

      let failCalls = 0
      const staysBusy = fake(() => {
        failCalls++
        return new Response(JSON.stringify({ description: 'service is busy, too many concurrent requests(600)' }), {
          status: 429,
          headers: busyHeaders,
        })
      })
      const busyPromise = scoreExaoneBatch(settings, '전산 직무', items, { fetch: staysBusy.fetch })
      await vi.advanceTimersByTimeAsync(19_000)
      const err = await busyPromise
      expect(failCalls).toBe(4)
      expect(err).toEqual({
        kind: 'error',
        error: {
          kind: 'rateLimited',
          detail: '초당 1/1 · 분당 60/60 · 일일 86394/86400 · service is busy, too many concurrent requests(600)',
        },
      })
      if (err.kind === 'error') {
        expect(formatAiError(err.error, 'exaone')).toContain('EXAONE 서버가 일시적으로 혼잡합니다')
        expect(formatAiError(err.error, 'exaone')).not.toContain('사용량 한도를 확인해 주세요')
      }
    } finally {
      vi.useRealTimers()
    }
  })

  it('distinguishes stream aborts from non-JSON HTTP 200 payloads, repairs noisy JSON, and retries once on badResponse', async () => {
    vi.useFakeTimers()
    try {
      const htmlGateway = fake(() => new Response(`<html>502 Bad Gateway ${KEY}</html>`, { status: 200 }))
      const htmlPromise = scoreExaoneBatch(settings, 'x', items, { fetch: htmlGateway.fetch })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(await htmlPromise).toEqual({
        kind: 'error',
        error: { kind: 'badResponse', detail: '응답이 JSON이 아닙니다 (<html>502 Bad Gateway ***</html>)' },
      })

      const emptyOk = fake(() => new Response('', { status: 200 }))
      const emptyPromise = scoreExaoneBatch(settings, 'x', items, { fetch: emptyOk.fetch })
      await vi.advanceTimersByTimeAsync(3_000)
      expect(await emptyPromise).toEqual({
        kind: 'error',
        error: { kind: 'badResponse', detail: '응답이 JSON이 아닙니다 (빈 응답)' },
      })

      const noisyBracketsAndComma = fake(() =>
        json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  '평가 결과 [2건]입니다:\n[{"index":0,"score":85,"reason":"전산 [정규직] 맞음"},{"index":1,"score":30,"reason":"무관"},]\n[참고] 완료',
              },
            },
          ],
        }),
      )
      expect(await scoreExaoneBatch(settings, 'x', items, { fetch: noisyBracketsAndComma.fetch })).toEqual({
        kind: 'ok',
        scores: [
          { index: 0, score: 85, reason: '전산 [정규직] 맞음' },
          { index: 1, score: 30, reason: '무관' },
        ],
      })

      const wrappedObject = fake(() =>
        json({
          choices: [{ finish_reason: 'stop', message: { content: JSON.stringify({ scores: goodScores }) } }],
        }),
      )
      expect((await scoreExaoneBatch(settings, 'x', items, { fetch: wrappedObject.fetch })).kind).toBe('ok')

      const stutteredReasonQuotes = fake(() =>
        json({
          choices: [
            {
              finish_reason: 'stop',
              message: {
                content:
                  '[{"index":0,"score":5,"reason":":"회계·경리·세무 담당자로 전산직이나 정보시스템 운영·유지보수와 직무가 다릅니다."},{"index":1,"score":80,"reason":"제목의 "전산" 운영 직무와 일치합니다."}]',
              },
            },
          ],
        }),
      )
      expect(await scoreExaoneBatch(settings, 'x', items, { fetch: stutteredReasonQuotes.fetch })).toEqual({
        kind: 'ok',
        scores: [
          { index: 0, score: 5, reason: '회계·경리·세무 담당자로 전산직이나 정보시스템 운영·유지보수와 직무가 다릅니다.' },
          { index: 1, score: 80, reason: '제목의 "전산" 운영 직무와 일치합니다.' },
        ],
      })

      let badJsonCalls = 0
      const flakyJson = fake(() => {
        badJsonCalls++
        const content = badJsonCalls === 1 ? 'broken {json' : JSON.stringify(goodScores)
        return json({ choices: [{ finish_reason: 'stop', message: { content } }] })
      })
      const flakyPromise = scoreExaoneBatch(settings, 'x', items, { fetch: flakyJson.fetch })
      await vi.advanceTimersByTimeAsync(3_000)
      expect((await flakyPromise).kind).toBe('ok')
      expect(badJsonCalls).toBe(2)

      const abortedStream = fake(() => {
        const res = new Response('partial')
        Object.defineProperty(res, 'text', { value: () => Promise.reject(new DOMException('Timed out', 'TimeoutError')) })
        return res
      })
      const timeoutPromise = scoreExaoneBatch(settings, 'x', items, { fetch: abortedStream.fetch })
      await vi.advanceTimersByTimeAsync(3_000)
      const timeoutResult = await timeoutPromise
      expect(timeoutResult).toEqual({
        kind: 'error',
        error: { kind: 'network', detail: '180초 응답 시간 초과' },
      })
      if (timeoutResult.kind === 'error') {
        expect(formatAiError(timeoutResult.error, 'exaone')).toContain('180초 응답 시간 초과')
      }

      let netCalls = 0
      const transientNet = fake(() => {
        netCalls++
        if (netCalls === 1) return Promise.reject(new TypeError('Failed to fetch'))
        return json({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(goodScores) } }] })
      })
      const recoverNetPromise = scoreExaoneBatch(settings, 'x', items, { fetch: transientNet.fetch })
      await vi.advanceTimersByTimeAsync(3_000)
      expect((await recoverNetPromise).kind).toBe('ok')
      expect(netCalls).toBe(2)

      const sixItems: ScoreItem[] = [0, 1, 2, 3, 4, 5].map((index) => ({
        index,
        title: `전산 공고 ${index}`,
        company: '기관',
        jobTags: ['전산'],
        career: '경력무관',
        locations: ['서울'],
      }))
      let splitCalls = 0
      const splitRecovery = fake(() => {
        splitCalls++
        if (splitCalls === 1) return Promise.reject(new DOMException('Timed out', 'TimeoutError'))
        const indices = splitCalls === 2 ? [0, 1, 2] : [3, 4, 5]
        return json({
          choices: [
            {
              finish_reason: 'stop',
              message: { content: JSON.stringify(indices.map((index) => ({ index, score: 80, reason: '적합' }))) },
            },
          ],
          usage: { prompt_tokens: 100, completion_tokens: 50, reasoning_tokens: 20, total_tokens: 150 },
        })
      })
      const splitPromise = scoreExaoneBatch(settings, 'x', sixItems, { fetch: splitRecovery.fetch })
      await vi.advanceTimersByTimeAsync(6_000)
      const splitResult = await splitPromise
      expect(splitCalls).toBe(3)
      expect(splitResult).toEqual({
        kind: 'ok',
        scores: [0, 1, 2, 3, 4, 5].map((index) => ({ index, score: 80, reason: '적합' })),
        usage: { inputTokens: 200, outputTokens: 100, thoughtTokens: 40, cachedTokens: 0, totalTokens: 300 },
      })
    } finally {
      vi.useRealTimers()
    }
  })
})
