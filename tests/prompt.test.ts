import { describe, expect, it } from 'vitest'
import { buildInstruction, buildPrompt, SYSTEM_INSTRUCTION, toScoreItems } from '../src/ai/prompt'
import type { PendingPosting } from '../src/shared/types'
import { criteria, posting } from './helpers'

const pending = (id: string, title: string): PendingPosting => ({
  ...posting({ externalId: id, title, career: { kind: 'experienced', minYears: 3 }, jobTags: ['IT', '전산'], locations: ['서울>강남구'] }),
  matchedKeywords: [],
  queuedAt: '2026-11-13T00:00:00Z',
})

describe('buildInstruction', () => {
  it('uses the description as written when there is one', () => {
    const text = buildInstruction(criteria({ description: '  공공기관에서 전산 운영을 하고 싶습니다.  ', keywords: ['회계'] }))
    expect(text).toBe('공공기관에서 전산 운영을 하고 싶습니다.')
  })

  it('falls back to keywords, exclude keywords and career when the description is empty', () => {
    const text = buildInstruction(criteria({ description: ' ', keywords: ['전산', '회계'], excludeKeywords: ['영업'], career: 'new' }))
    expect(text).toContain('전산, 회계')
    expect(text).toContain('영업')
    expect(text).toContain('신입')
  })

  it('still says something when nothing is set', () => {
    expect(buildInstruction(criteria({ keywords: [] })).length).toBeGreaterThan(0)
  })
})

describe('buildPrompt', () => {
  const items = toScoreItems([pending('a', '전산 운영 담당'), pending('b', '보험 설계사')])

  it('numbers items from zero and sends only the listed fields', () => {
    expect(items.map((i) => i.index)).toEqual([0, 1])
    expect(Object.keys(items[0] ?? {}).sort()).toEqual(['career', 'company', 'index', 'jobTags', 'locations', 'title'])
    expect(items[0]?.career).toBe('경력 3년↑')
  })

  it('contains the instruction and every item\'s index and title', () => {
    const prompt = buildPrompt('전산 업무를 원합니다', items)
    expect(prompt).toContain('전산 업무를 원합니다')
    for (const item of items) {
      expect(prompt).toContain(`"index": ${item.index}`)
      expect(prompt).toContain(item.title)
    }
  })

  it('has no place for an API key', () => {
    const key = 'fake-key-for-local-test'
    expect(buildPrompt('원하는 일', items)).not.toContain(key)
    expect(SYSTEM_INSTRUCTION).not.toContain(key)
  })
})
