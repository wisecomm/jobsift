export interface Pacer {
  (overrideGapMs?: number): Promise<void>
  /** Advances the cooldown anchor to "now", e.g. when a request completes. */
  mark: () => void
}

/** Resolves immediately the first time, then no sooner than `gapMs` after the previous call or `mark()`. */
export function createPacer(gapMs: number, now: () => number, sleep: (ms: number) => Promise<void>): Pacer {
  let last: number | null = null
  const pace = async (overrideGapMs = gapMs) => {
    if (last !== null) {
      const wait = last + overrideGapMs - now()
      if (wait > 0) await sleep(wait)
    }
    last = now()
  }
  return Object.assign(pace, {
    mark: () => {
      last = now()
    },
  })
}
