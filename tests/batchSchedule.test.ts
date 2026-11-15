import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BATCH_HOURS,
  HOUR_MS,
  MAX_BATCH_HOURS,
  clampBatchHours,
  formatClockTime,
  nextBatchRunAt,
  shouldTriggerBatch,
} from '../src/page/batchSchedule'

describe('batchSchedule', () => {
  it('clamps interval hours between 1 and 24 with safe fallback', () => {
    expect(clampBatchHours(0)).toBe(1)
    expect(clampBatchHours(-3)).toBe(1)
    expect(clampBatchHours(Number.NaN)).toBe(DEFAULT_BATCH_HOURS)
    expect(clampBatchHours(1.6)).toBe(2)
    expect(clampBatchHours(99)).toBe(MAX_BATCH_HOURS)
  })

  it('computes the next scheduled timestamp in whole hours', () => {
    const base = 1_700_000_000_000
    expect(nextBatchRunAt(base, 1)).toBe(base + HOUR_MS)
    expect(nextBatchRunAt(base, 3)).toBe(base + 3 * HOUR_MS)
  })

  it('triggers only when enabled, idle, collectible, and due', () => {
    const due = 2_000_000
    expect(shouldTriggerBatch({ enabled: true, busy: false, canCollect: true, nowMs: due, nextRunAt: due })).toBe(true)
    expect(shouldTriggerBatch({ enabled: true, busy: false, canCollect: true, nowMs: due - 1, nextRunAt: due })).toBe(false)
    expect(shouldTriggerBatch({ enabled: false, busy: false, canCollect: true, nowMs: due, nextRunAt: due })).toBe(false)
    expect(shouldTriggerBatch({ enabled: true, busy: true, canCollect: true, nowMs: due, nextRunAt: due })).toBe(false)
    expect(shouldTriggerBatch({ enabled: true, busy: false, canCollect: false, nowMs: due, nextRunAt: due })).toBe(false)
    expect(shouldTriggerBatch({ enabled: true, busy: false, canCollect: true, nowMs: due, nextRunAt: null })).toBe(false)
  })

  it('formats local clock time as zero-padded HH:MM', () => {
    const sample = new Date(2026, 10, 14, 5, 7, 0).getTime()
    expect(formatClockTime(sample)).toBe('05:07')
  })
})
