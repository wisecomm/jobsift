import { describe, expect, it } from 'vitest'
import { getAdapter } from '../src/adapter/registry'
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

  it('builds saramin search URLs with dual career parameters', () => {
    const saramin = getAdapter('saramin')!
    const urlNew = new URL(buildSearchUrl(saramin, criteria({ career: 'new' }), '전산', 2))
    expect(urlNew.searchParams.get('searchword')).toBe('전산')
    expect(urlNew.searchParams.get('recruitPage')).toBe('2')
    expect(urlNew.searchParams.get('exp_cd')).toBe('1')
    expect(urlNew.searchParams.get('exp_none')).toBe('y')

    const urlAny = new URL(buildSearchUrl(saramin, criteria({ career: 'any' }), '전산', 1))
    expect(urlAny.searchParams.has('exp_cd')).toBe(false)
    expect(urlAny.searchParams.has('exp_none')).toBe(false)
  })

  it('builds gojobs search URLs with searchKeyword and pageIndex', () => {
    const gojobs = getAdapter('gojobs')!
    const url = new URL(buildSearchUrl(gojobs, criteria(), '전산', 3))
    expect(url.searchParams.get('searchKeyword')).toBe('전산')
    expect(url.searchParams.get('pageIndex')).toBe('3')
  })
})
