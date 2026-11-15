import type { Request, ResponseFor } from '../shared/messages'
import type { PostingKey, PostingPatch, StoredPosting } from '../shared/types'

export type RpcPortMessage<R extends Request = Request> =
  | { kind: 'ping' }
  | { kind: 'progress'; text: string }
  | { kind: 'committed' }
  | { kind: 'response'; response: ResponseFor<R> }

export function send<R extends Request>(
  request: R,
  onProgress?: (text: string) => void,
  onCommitted?: () => void,
): Promise<Extract<ResponseFor<R>, { ok: true }>['data']> {
  return new Promise((resolve, reject) => {
    const port = chrome.runtime.connect({ name: 'rpc' })
    let settled = false

    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      try {
        port.disconnect()
      } catch {
        // already disconnected
      }
      fn()
    }

    port.onMessage.addListener((msg: RpcPortMessage<R>) => {
      if (msg.kind === 'ping') return
      if (msg.kind === 'progress') {
        onProgress?.(msg.text)
        return
      }
      if (msg.kind === 'committed') {
        onCommitted?.()
        return
      }
      finish(() => {
        if (!msg.response.ok) reject(new Error(msg.response.error))
        else resolve(msg.response.data)
      })
    })

    port.onDisconnect.addListener(() => {
      const reason = chrome.runtime.lastError?.message
      finish(() =>
        reject(
          new Error(
            reason
              ? `백그라운드 연결이 끊어졌습니다: ${reason}`
              : '백그라운드 응답 전에 연결이 끊어졌습니다. 확장 프로그램을 새로고침한 뒤 다시 시도해 주세요.',
          ),
        ),
      )
    })

    port.postMessage(request)
  })
}

export async function updatePosting(key: PostingKey, patch: PostingPatch): Promise<StoredPosting> {
  const result = await send({ type: 'updatePosting', key, patch })
  if (result.kind === 'updated') return result.posting
  throw new Error(result.kind === 'expired' ? '마감된 공고는 상태를 바꿀 수 없습니다.' : '공고를 찾을 수 없습니다. 새로고침해 보세요.')
}
