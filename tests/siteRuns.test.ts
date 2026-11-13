import { describe, expect, it } from 'vitest'
import { loadSiteRuns, recordSiteRuns } from '../src/engine/siteRuns'
import type { CollectionSummary, SiteRunStatus } from '../src/shared/types'

const summary: CollectionSummary = {
  scanned: 5, saved: 2, queued: 0, aiOn: false, discarded: 3, expiredMarked: 0, stopReasons: { 전산: 'exhausted' }, errors: {},
  discardedByGate: { expired: 0, excludeKeyword: 0, keywordMismatch: 3, location: 0, career: 0, lowScore: 0 },
}
const ok = (site: string, at: string): SiteRunStatus => ({ site, at, result: { kind: 'ok', summary } })

function area() {
  const data: Record<string, unknown> = {}
  return { data, get: async (key: string) => ({ [key]: data[key] }), set: async (items: Record<string, unknown>) => void Object.assign(data, items) }
}

describe('site run status storage', () => {
  it('survives a reload and keeps the latest run per site', async () => {
    const a = area()
    await recordSiteRuns(a, [ok('jobkorea', '2026-11-13T10:00:00Z')])
    await recordSiteRuns(a, [ok('second', '2026-11-13T11:00:00Z'), { site: 'jobkorea', at: '2026-11-13T12:00:00Z', result: { kind: 'error', message: '실패' } }])

    const runs = await loadSiteRuns(a)
    expect(Object.keys(runs).sort()).toEqual(['jobkorea', 'second'])
    expect(runs.jobkorea).toEqual({ site: 'jobkorea', at: '2026-11-13T12:00:00Z', result: { kind: 'error', message: '실패' } })
    expect(runs.second).toEqual(ok('second', '2026-11-13T11:00:00Z'))
  })

  it('drops stored entries that no longer parse', async () => {
    const a = area()
    a.data.siteRuns = { jobkorea: { site: 'jobkorea', at: 'x', result: { kind: 'ok', summary: { scanned: 'many' } } }, second: ok('second', 'y') }
    expect(Object.keys(await loadSiteRuns(a))).toEqual(['second'])
    a.data.siteRuns = 'garbage'
    expect(await loadSiteRuns(a)).toEqual({})
  })
})
