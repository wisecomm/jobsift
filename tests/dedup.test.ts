import { describe, expect, it } from 'vitest'
import { addSource, dedupKey, normalizeCompany, normalizeLocations, normalizeTitle } from '../src/engine/dedup'
import type { PostingSource } from '../src/shared/types'
import { posting } from './helpers'

describe('cross-site normalization & dedupKey', () => {
  it('strips corporate markers, spaces, brackets, and lowercases company and title', () => {
    expect(normalizeCompany('(주)테스트')).toBe(normalizeCompany('주식회사 테스트'))
    expect(normalizeCompany('㈜예진')).toBe(normalizeCompany('예진(주)'))
    expect(normalizeTitle('[서울] 백엔드 (Backend) 개발자 모집!')).toBe('서울백엔드backend개발자모집')
    expect(normalizeTitle('백엔드 개발자 모집')).not.toBe(normalizeTitle('프론트엔드 개발자 모집'))
  })

  it('normalizes locations while preserving branch differences and ignoring order or 전체 suffix', () => {
    expect(normalizeLocations(['인천'])).toBe(normalizeLocations(['인천전체']))
    expect(normalizeLocations(['서울>강남구', '경기>성남시'])).toBe(normalizeLocations(['경기>성남시', '서울>강남구']))
    expect(normalizeLocations(['서울>강남구'])).not.toBe(normalizeLocations(['서울>마포구']))
  })

  it('produces identical dedupKey for normalized duplicates and different keys across branches', () => {
    const a = posting({ site: 'jobkorea', externalId: '1', company: '(주)가나다', title: '전산 담당자', locations: ['인천전체'] })
    const b = posting({ site: 'saramin', externalId: '2', company: '주식회사 가나다', title: '전산담당자', locations: ['인천'] })
    const c = posting({ site: 'saramin', externalId: '3', company: '주식회사 가나다', title: '전산담당자', locations: ['서울>강남구'] })

    expect(dedupKey(a)).toBe(dedupKey(b))
    expect(dedupKey(a)).not.toBe(dedupKey(c))
  })

  it('appends new site sources and merges matchedKeywords idempotently', () => {
    const base = { ...posting({ site: 'jobkorea', externalId: '1' }), matchedKeywords: ['전산'], alsoOn: undefined as PostingSource[] | undefined }
    const incoming = posting({ site: 'saramin', externalId: '99', url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=99' })

    const updated = addSource(base, incoming, ['IT'])
    expect(updated?.alsoOn).toEqual([{ site: 'saramin', externalId: '99', url: incoming.url }])
    expect(updated?.matchedKeywords).toEqual(['전산', 'IT'])

    expect(addSource(updated!, incoming, ['전산'])).toBeNull()
  })
})
