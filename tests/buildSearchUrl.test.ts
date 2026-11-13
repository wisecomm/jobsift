import { describe, expect, it } from 'vitest'
import { buildSearchUrl } from '../src/engine/buildSearchUrl'
import { adapter, criteria } from './helpers'

describe('buildSearchUrl', () => {
  it('percent-encodes a Korean keyword and fills the page number', () => {
    const url = new URL(buildSearchUrl(adapter, criteria(), '전산 관리', 3))
    expect(url.searchParams.get('stext')).toBe('전산 관리')
    expect(url.searchParams.get('Page_No')).toBe('3')
    expect(url.searchParams.get('ord')).toBe('RegDtDesc')
    expect(buildSearchUrl(adapter, criteria(), '전산', 1)).toContain('stext=%EC%A0%84%EC%82%B0')
  })

  it('maps the career criterion to the site code and omits it for any', () => {
    expect(buildSearchUrl(adapter, criteria({ career: 'new' }), '전산', 1)).toContain('careerType=1,4')
    expect(buildSearchUrl(adapter, criteria({ career: 'experienced' }), '전산', 1)).toContain('careerType=2,4')
    expect(buildSearchUrl(adapter, criteria({ career: 'any' }), '전산', 1)).not.toContain('careerType')
  })
})
