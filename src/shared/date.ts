export const KST_OFFSET_MS = 9 * 60 * 60 * 1000
export const DAY_MS = 24 * 60 * 60 * 1000

/** Whole-day index in Korean Standard Time, so date-only comparisons agree with Korean job sites. */
export const kstDay = (ms: number): number => Math.floor((ms + KST_OFFSET_MS) / DAY_MS)
