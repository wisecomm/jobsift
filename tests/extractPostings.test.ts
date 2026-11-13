import { describe, expect, it } from 'vitest'
import { extractPostings } from '../src/engine/extractPostings'
import { findDehydratedQuery, readFlightPayload } from '../src/engine/flight'
import { adapter, fixtureHtml } from './helpers'

describe('extractPostings on the JobKorea fixture', () => {
  const postings = extractPostings(adapter, fixtureHtml)

  it('returns the 20 results of the page with the required fields filled', () => {
    expect(postings).toHaveLength(20)
    for (const p of postings) {
      expect(p.externalId).not.toBe('')
      expect(p.title).not.toBe('')
      expect(p.company).not.toBe('')
      expect(p.postedAt).not.toBe('')
      expect(p.url).toBe(`https://www.jobkorea.co.kr/Recruit/GI_Read/${p.externalId}`)
    }
  })

  it('keeps newest-first order', () => {
    const times = postings.map((p) => Date.parse(p.postedAt))
    expect(times).toEqual([...times].sort((a, b) => b - a))
  })

  it('resolves area codes to names', () => {
    const first = postings.find((p) => p.externalId === '50365639')
    expect(first?.locations).toEqual(['서울>강남구'])
    const two = postings.find((p) => p.externalId === '50363397')
    expect(two?.locations).toHaveLength(2)
    for (const p of postings) for (const l of p.locations) expect(l).not.toMatch(/^[A-Z]\d{3}$/)
  })

  it('maps career codes to the labels the page shows', () => {
    const career = (id: string) => postings.find((p) => p.externalId === id)?.career
    expect(career('50365465')).toEqual({ kind: 'new' })
    expect(career('50365639')).toEqual({ kind: 'any' })
    expect(career('50365271')).toEqual({ kind: 'experienced', minYears: 3 })
    expect(career('50365538')).toEqual({ kind: 'newOrExperienced', minYears: 3 })
    expect(career('50363397')).toEqual({ kind: 'newOrExperienced', minYears: null })
  })

  it('splits the tag string into tags', () => {
    expect(postings.find((p) => p.externalId === '50365639')?.jobTags).toEqual(['회계·세무·법무', '회계담당자', '세무담당자'])
  })

  it('leaves ad-slot postings out', () => {
    const payload = readFlightPayload(fixtureHtml)
    const content = (key: string) =>
      ((findDehydratedQuery(payload, key) as { state: { data: { content: { id: string }[] } } }).state.data.content)
    const listIds = new Set(content('JOB_LIST').map((x) => x.id))
    const adOnly = content('JOB_CPC_SLOT_LIST').map((x) => x.id).filter((id) => !listIds.has(id))
    expect(adOnly.length).toBeGreaterThan(0)
    const found = new Set(postings.map((p) => p.externalId))
    for (const id of adOnly) expect(found.has(id)).toBe(false)
  })

  it('reports a missing deadline for an always-hire item (end year 2070)', () => {
    const alwaysHire = fixtureHtml.replace(
      String.raw`\"end\":\"2026-12-13T23:00:00+09:00\"`,
      String.raw`\"end\":\"2070-12-31T23:00:00+09:00\"`,
    )
    expect(alwaysHire).not.toBe(fixtureHtml)
    const changed = extractPostings(adapter, alwaysHire)
    expect(changed.find((p) => p.externalId === '50365639')?.deadline).toBeNull()
    expect(postings.find((p) => p.externalId === '50365639')?.deadline).toBe('2026-12-13T23:00:00+09:00')
  })

  it('fails loudly when the page has no JOB_LIST (site changed)', () => {
    expect(() => extractPostings(adapter, '<html></html>')).toThrow(/JOB_LIST/)
  })
})
