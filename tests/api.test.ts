import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { emptyAiUsage } from '../src/ai/usage'
import { send, type RpcPortMessage } from '../src/page/api'
import type { Request } from '../src/shared/messages'

type MessageListener = (msg: RpcPortMessage) => void
type DisconnectListener = () => void

function createFakePort() {
  const messageListeners: MessageListener[] = []
  const disconnectListeners: DisconnectListener[] = []
  const postMessage = vi.fn()
  const disconnect = vi.fn()

  return {
    port: {
      name: 'rpc',
      postMessage,
      disconnect,
      onMessage: { addListener: (fn: MessageListener) => messageListeners.push(fn) },
      onDisconnect: { addListener: (fn: DisconnectListener) => disconnectListeners.push(fn) },
    },
    emitMessage: (msg: RpcPortMessage) => {
      for (const fn of messageListeners) fn(msg)
    },
    emitDisconnect: () => {
      for (const fn of disconnectListeners) fn()
    },
    postMessage,
    disconnect,
  }
}

describe('page api send', () => {
  const originalChrome = globalThis.chrome

  beforeEach(() => {
    vi.restoreAllMocks()
  })

  afterEach(() => {
    globalThis.chrome = originalChrome
  })

  it('ignores ping messages and resolves with response data', async () => {
    const fake = createFakePort()
    const connect = vi.fn(() => fake.port)
    globalThis.chrome = { runtime: { connect, lastError: undefined } } as unknown as typeof chrome

    const req: Request = { type: 'getAiUsage' }
    const progress: string[] = []
    let committed = 0
    const promise = send(req, (text) => progress.push(text), () => committed++)

    expect(connect).toHaveBeenCalledWith({ name: 'rpc' })
    expect(fake.postMessage).toHaveBeenCalledWith(req)

    fake.emitMessage({ kind: 'ping' })
    fake.emitMessage({ kind: 'progress', text: '잡코리아 수집 중…' })
    fake.emitMessage({ kind: 'committed' })
    expect(progress).toEqual(['잡코리아 수집 중…'])
    expect(committed).toBe(1)
    expect(fake.disconnect).not.toHaveBeenCalled()

    const payload = emptyAiUsage()
    fake.emitMessage({ kind: 'response', response: { ok: true, data: payload } })

    await expect(promise).resolves.toEqual(payload)
    expect(fake.disconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects when response ok is false', async () => {
    const fake = createFakePort()
    globalThis.chrome = {
      runtime: { connect: vi.fn(() => fake.port), lastError: undefined },
    } as unknown as typeof chrome

    const promise = send({ type: 'scorePending' })
    fake.emitMessage({ kind: 'response', response: { ok: false, error: '테스트 오류' } })

    await expect(promise).rejects.toThrow('테스트 오류')
    expect(fake.disconnect).toHaveBeenCalledTimes(1)
  })

  it('rejects with lastError message or fallback message on premature disconnect', async () => {
    const fake1 = createFakePort()
    globalThis.chrome = {
      runtime: {
        connect: vi.fn(() => fake1.port),
        lastError: { message: 'Could not establish connection.' },
      },
    } as unknown as typeof chrome

    const p1 = send({ type: 'collect' })
    fake1.emitDisconnect()
    await expect(p1).rejects.toThrow('백그라운드 연결이 끊어졌습니다: Could not establish connection.')

    const fake2 = createFakePort()
    globalThis.chrome = {
      runtime: { connect: vi.fn(() => fake2.port), lastError: undefined },
    } as unknown as typeof chrome

    const p2 = send({ type: 'collect' })
    fake2.emitDisconnect()
    await expect(p2).rejects.toThrow('백그라운드 응답 전에 연결이 끊어졌습니다.')
  })
})
