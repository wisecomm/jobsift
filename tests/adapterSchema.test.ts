import { describe, expect, it } from 'vitest'
import jobkoreaJson from '../adapters/jobkorea.json'
import { adapterIds, adapters, buildRegistry } from '../src/adapter/registry'
import { parseAdapter } from '../src/adapter/schema'

const clone = () => structuredClone(jobkoreaJson) as Record<string, any>

describe('parseAdapter', () => {
  it('accepts the bundled JobKorea adapter', () => {
    expect(parseAdapter(jobkoreaJson).id).toBe('jobkorea')
  })

  it('rejects an adapter without a home address or login flag', () => {
    const noHome = clone()
    delete noHome.homeUrl
    expect(() => parseAdapter(noHome)).toThrow()
    const badFlag = clone()
    badFlag.requiresLogin = 'no'
    expect(() => parseAdapter(badFlag)).toThrow()
  })

  it('rejects a URL template without the keyword placeholder', () => {
    const bad = clone()
    bad.search.urlTemplate = 'https://www.jobkorea.co.kr/Search/?page={page}'
    expect(() => parseAdapter(bad)).toThrow()
  })

  it('rejects an unknown extract kind', () => {
    const bad = clone()
    bad.extract.kind = 'run-script'
    expect(() => parseAdapter(bad)).toThrow()
  })

  it('rejects a missing field path', () => {
    const bad = clone()
    delete bad.extract.fields.title
    expect(() => parseAdapter(bad)).toThrow()
  })

  it('rejects a parameter value that is not plain query-string characters', () => {
    const bad = clone()
    bad.search.params[0].values.new = '1&admin=1'
    expect(() => parseAdapter(bad)).toThrow()
  })
})

describe('adapter registry', () => {
  it('parses every bundled adapter with a unique id', () => {
    expect(adapterIds).toEqual(['jobkorea', 'saramin', 'gojobs'])
    expect(adapters).toHaveLength(3)
    expect(new Set(adapterIds).size).toBe(adapterIds.length)
  })

  it('refuses two adapters with the same id', () => {
    expect(() => buildRegistry([jobkoreaJson, jobkoreaJson])).toThrow(/jobkorea/)
  })
})
