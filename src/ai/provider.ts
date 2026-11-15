import type { AiSettings } from '../shared/types'
import { scoreExaoneBatch } from './exaone'
import { scoreBatch as scoreGeminiBatch } from './gemini'
import type { FetchLike } from './parseScores'
import type { ScoreItem, ScoreResult } from './types'

export function scoreWithProvider(
  settings: AiSettings,
  instruction: string,
  items: readonly ScoreItem[],
  deps: { fetch: FetchLike; signal?: AbortSignal },
): Promise<ScoreResult> {
  return settings.provider === 'exaone'
    ? scoreExaoneBatch(settings, instruction, items, deps)
    : scoreGeminiBatch(settings, instruction, items, deps)
}

export function checkProviderKey(settings: AiSettings, deps: { fetch: FetchLike }): Promise<ScoreResult> {
  const probe: ScoreItem = { index: 0, title: '사무 보조', company: '테스트', jobTags: [], career: '경력무관', locations: [] }
  return scoreWithProvider(settings, '사무직을 찾고 있습니다.', [probe], deps)
}
