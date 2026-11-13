import type { Request, ResponseFor } from '../shared/messages'
import type { PostingKey, PostingPatch, StoredPosting } from '../shared/types'

export async function send<R extends Request>(request: R): Promise<Extract<ResponseFor<R>, { ok: true }>['data']> {
  const response: ResponseFor<R> = await chrome.runtime.sendMessage(request)
  if (!response.ok) throw new Error(response.error)
  return response.data
}

export async function updatePosting(key: PostingKey, patch: PostingPatch): Promise<StoredPosting> {
  const result = await send({ type: 'updatePosting', key, patch })
  if (result.kind === 'updated') return result.posting
  throw new Error(result.kind === 'expired' ? '마감된 공고는 상태를 바꿀 수 없습니다.' : '공고를 찾을 수 없습니다. 새로고침해 보세요.')
}
