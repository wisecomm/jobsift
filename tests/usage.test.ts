import { describe, expect, it } from 'vitest'
import { clearAiUsage, emptyAiUsage, loadAiUsage, recordAiUsage, splitUsageBySite } from '../src/ai/usage'
import type { StorageArea } from '../src/ai/settings'

function memoryArea(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => void Object.assign(data, items),
  }
}

describe('AI token usage storage', () => {
  it('starts empty and falls back cleanly on unreadable storage', async () => {
    const area = memoryArea()
    expect(await loadAiUsage(area)).toEqual(emptyAiUsage())
    area.data.aiUsage = { requests: 'bad' }
    expect(await loadAiUsage(area)).toEqual(emptyAiUsage())
  })

  it('accumulates totals and per-model breakdowns across batches and clears cleanly', async () => {
    const area = memoryArea()
    const t1 = new Date('2026-11-14T10:00:00Z')
    const t2 = new Date('2026-11-14T10:05:00Z')

    await recordAiUsage(area, 'gemini-3.5-flash-lite', 10, { inputTokens: 300, outputTokens: 100, thoughtTokens: 50, cachedTokens: 0, totalTokens: 450 }, t1)
    const after = await recordAiUsage(
      area,
      'gemini-3.8-flash',
      5,
      { inputTokens: 200, outputTokens: 80, thoughtTokens: 120, cachedTokens: 20, totalTokens: 400 },
      t2,
    )

    expect(after).toEqual({
      requests: 2,
      scoredPostings: 15,
      totals: { inputTokens: 500, outputTokens: 180, thoughtTokens: 170, cachedTokens: 20, totalTokens: 850 },
      byModel: {
        'gemini-3.5-flash-lite': { requests: 1, inputTokens: 300, outputTokens: 100, thoughtTokens: 50, cachedTokens: 0, totalTokens: 450 },
        'gemini-3.8-flash': { requests: 1, inputTokens: 200, outputTokens: 80, thoughtTokens: 120, cachedTokens: 20, totalTokens: 400 },
      },
      updatedAt: t2.toISOString(),
    })

    await clearAiUsage(area)
    expect(await loadAiUsage(area)).toEqual(emptyAiUsage())
  })

  it('splits batch usage proportionally across sites without rounding drift', () => {
    const usage = { inputTokens: 101, outputTokens: 50, thoughtTokens: 31, cachedTokens: 3, totalTokens: 182 }
    const split = splitUsageBySite(usage, ['jobkorea', 'jobkorea', 'saramin'])
    expect(split.jobkorea!.totalTokens + split.saramin!.totalTokens).toBe(182)
    expect(split.jobkorea!.inputTokens + split.saramin!.inputTokens).toBe(101)
    expect(split.jobkorea).toEqual({ inputTokens: 67, outputTokens: 33, thoughtTokens: 21, cachedTokens: 2, totalTokens: 121 })
    expect(split.saramin).toEqual({ inputTokens: 34, outputTokens: 17, thoughtTokens: 10, cachedTokens: 1, totalTokens: 61 })
  })
})
