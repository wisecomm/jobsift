import type { TokenUsage } from '../shared/types'

/** One posting as the model sees it: nothing but what scoring needs. */
export interface ScoreItem {
  index: number
  title: string
  company: string
  jobTags: string[]
  career: string
  employmentTypes?: string[]
  locations: string[]
}

export interface PostingScore {
  index: number
  score: number
  reason: string
}

export type AiError =
  | { kind: 'invalidKey' }
  | { kind: 'rateLimited'; detail?: string }
  | { kind: 'unknownModel'; model: string }
  | { kind: 'badRequest'; status: number; detail: string }
  | { kind: 'badResponse'; detail: string }
  | { kind: 'network'; detail?: string }
  | { kind: 'server'; status: number }
  | { kind: 'incomplete'; status: string }

export type ScoreResult = { kind: 'ok'; scores: PostingScore[]; usage?: TokenUsage } | { kind: 'error'; error: AiError }

/** Scores one batch. Settings, instruction and transport are already bound by the caller. */
export type ScoreFn = (items: ScoreItem[]) => Promise<ScoreResult>
