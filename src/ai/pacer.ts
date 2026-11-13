/** Resolves immediately the first time, then no sooner than `gapMs` after the previous call resolved. */
export function createPacer(gapMs: number, now: () => number, sleep: (ms: number) => Promise<void>): () => Promise<void> {
  let last: number | null = null
  return async () => {
    if (last !== null) {
      const wait = last + gapMs - now()
      if (wait > 0) await sleep(wait)
    }
    last = now()
  }
}
