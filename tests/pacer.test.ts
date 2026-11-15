import { describe, expect, it } from 'vitest'
import { createPacer } from '../src/ai/pacer'

describe('createPacer', () => {
  it('lets the first call through and then waits out the remaining gap', async () => {
    let clock = 1000
    const slept: number[] = []
    const pace = createPacer(4000, () => clock, async (ms) => { slept.push(ms); clock += ms })

    await pace()
    clock += 1500
    await pace()
    clock += 9000
    await pace()

    expect(slept).toEqual([2500])
  })

  it('waits a full gap after mark() and supports per-call override gaps', async () => {
    let clock = 1000
    const slept: number[] = []
    const pace = createPacer(4000, () => clock, async (ms) => { slept.push(ms); clock += ms })

    await pace(6000)
    clock += 8000 // long request duration
    pace.mark() // request completed at t=9000
    clock += 1000
    await pace(6000)

    expect(slept).toEqual([5000])
  })
})
