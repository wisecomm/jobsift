export const DEFAULT_BATCH_HOURS = 1
export const MAX_BATCH_HOURS = 24
export const HOUR_MS = 3_600_000

/** Clamps user-entered interval hours to a safe 1..24 integer range. */
export function clampBatchHours(raw: number): number {
  if (!Number.isFinite(raw)) return DEFAULT_BATCH_HOURS
  return Math.min(MAX_BATCH_HOURS, Math.max(1, Math.round(raw)))
}

export function nextBatchRunAt(nowMs: number, hours: number): number {
  return nowMs + clampBatchHours(hours) * HOUR_MS
}

export function formatClockTime(epochMs: number): string {
  const d = new Date(epochMs)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function shouldTriggerBatch(state: {
  enabled: boolean
  busy: boolean
  canCollect: boolean
  nowMs: number
  nextRunAt: number | null
}): boolean {
  return state.enabled && !state.busy && state.canCollect && state.nextRunAt !== null && state.nowMs >= state.nextRunAt
}
