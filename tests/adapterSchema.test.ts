import { describe, expect, it } from 'vitest'
import jobkoreaJson from '../adapters/jobkorea.json'
import { parseAdapter } from '../src/adapter/schema'

const clone = () => structuredClone(jobkoreaJson) as Record<string, any>

describe('parseAdapter', () => {
  it('accepts the bundled JobKorea adapter', () => {
    expect(parseAdapter(jobkoreaJson).id).toBe('jobkorea')
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
