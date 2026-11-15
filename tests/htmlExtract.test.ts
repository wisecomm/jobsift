import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { getAdapter } from '../src/adapter/registry'
import { extractPage } from '../src/engine/extractPostings'
import { inferRegionFromCompany, parseCareerText, parseDeadlineDate, parsePostedAtDate } from '../src/engine/htmlExtract'

const fixture = (name: string) => fs.readFileSync(path.join(import.meta.dirname, 'fixtures', name), 'utf8')

describe('HTML field parsers', () => {
  it('parses YY/MM/DD and YYYY-MM-DD postedAt dates in KST', () => {
    expect(parsePostedAtDate('등록일 26/11/13')).toBe('2026-11-13T00:00:00+09:00')
    expect(parsePostedAtDate('수정일 26/11/13')).toBe('2026-11-13T00:00:00+09:00')
    expect(parsePostedAtDate('2026-11-13')).toBe('2026-11-13T00:00:00+09:00')
    expect(parsePostedAtDate('2026-02-30')).toBeNull()
    expect(parsePostedAtDate('날짜없음')).toBeNull()
  })

  it('parses deadlines including Dec-to-Jan year rollover and non-date labels', () => {
    expect(parseDeadlineDate('~ 11/28(토)', '2026-11-13T00:00:00+09:00')).toBe('2026-11-28T23:59:59+09:00')
    expect(parseDeadlineDate('~ 01/05(화)', '2026-12-28T00:00:00+09:00')).toBe('2027-01-05T23:59:59+09:00')
    expect(parseDeadlineDate('2026-11-25', '2026-11-13T00:00:00+09:00')).toBe('2026-11-25T23:59:59+09:00')
    expect(parseDeadlineDate('채용시', '2026-11-13T00:00:00+09:00')).toBeNull()
    expect(parseDeadlineDate('상시채용', '2026-11-13T00:00:00+09:00')).toBeNull()
    expect(parseDeadlineDate('진행예정', '2026-11-13T00:00:00+09:00')).toBeNull()
  })

  it('parses Korean career text variants', () => {
    expect(parseCareerText('경력1년↑')).toEqual({ kind: 'experienced', minYears: 1 })
    expect(parseCareerText('경력무관')).toEqual({ kind: 'any' })
    expect(parseCareerText('신입·경력')).toEqual({ kind: 'newOrExperienced', minYears: null })
    expect(parseCareerText('신입 · 경력3년↑')).toEqual({ kind: 'newOrExperienced', minYears: 3 })
    expect(parseCareerText('신입')).toEqual({ kind: 'new' })
    expect(parseCareerText('')).toEqual({ kind: 'unknown' })
  })

  it('infers canonical region from agency name prefix', () => {
    expect(inferRegionFromCompany('서울특별시 강동구')).toEqual(['서울'])
    expect(inferRegionFromCompany('강원대학교')).toEqual(['강원'])
    expect(inferRegionFromCompany('충청북도 청주시')).toEqual(['충북'])
    expect(inferRegionFromCompany('제주특별자치도')).toEqual(['제주'])
    expect(inferRegionFromCompany('병무청')).toEqual([])
  })
})

describe('extractPage for saramin fixture', () => {
  const saramin = getAdapter('saramin')!

  it('extracts 40 postings, 11 modifiedIds, careers, locations, tags, and totalPages', () => {
    const page = extractPage(saramin, fixture('saramin-search-p1.html'))

    expect(page.postings).toHaveLength(40)
    expect(page.totalPages).toBe(252)
    expect(page.modifiedIds?.size).toBe(11)
    expect(page.postings[0]).toEqual({
      site: 'saramin',
      externalId: '55570661',
      title: '[글로벌 향수·코스메틱 3PL] 브랜드 물류 운영담당자',
      company: '업사이드',
      locations: ['경기>김포시'],
      career: { kind: 'experienced', minYears: 1 },
      jobTags: ['물류관리', '재고관리', '물류업'],
      postedAt: '2026-11-13T00:00:00+09:00',
      deadline: '2026-11-28T23:59:59+09:00',
      employmentTypes: ['regular'],
      url: 'https://www.saramin.co.kr/zf_user/jobs/relay/view?rec_idx=55570661',
    })
    expect(page.postings.filter((p) => p.deadline === null)).toHaveLength(5)
    expect(page.postings.some((p) => p.career.kind === 'new')).toBe(true)
    expect(page.postings.some((p) => p.career.kind === 'newOrExperienced')).toBe(true)
    expect(page.postings.some((p) => p.career.kind === 'any')).toBe(true)
  })

  it('returns empty postings when .info_no_result is shown alongside popular .item_recruit cards', () => {
    const html = `
      <div class="info_no_result">검색 결과가 없습니다.</div>
      <div class="not_found"><div class="section_search">
        <div class="item_recruit" value="999"><div class="job_tit"><a>인기 공고</a></div><div class="corp_name">회사</div><div class="job_day">등록일 26/11/13</div></div>
      </div></div>
    `
    const page = extractPage(saramin, html)
    expect(page.postings).toEqual([])
  })

  it('throws on unexpected HTML missing the ready container', () => {
    expect(() => extractPage(saramin, '<html><body>blocked</body></html>')).toThrow(/saramin/)
  })
})

describe('extractPage for gojobs fixtures', () => {
  const gojobs = getAdapter('gojobs')!

  it('extracts gojobs-list-p1 with inferred regions and totalPages', () => {
    const page = extractPage(gojobs, fixture('gojobs-list-p1.html'))

    expect(page.postings).toHaveLength(10)
    expect(page.totalPages).toBe(20078)
    expect(page.postings[0]).toEqual({
      site: 'gojobs',
      externalId: '308586',
      title: '서울특별시 강동구 시간선택제임기제공무원 라급 채용 공고 (상담전문요원)',
      company: '서울특별시 강동구',
      locations: ['서울'],
      career: { kind: 'unknown' },
      jobTags: [],
      postedAt: '2026-11-13T00:00:00+09:00',
      deadline: '2026-11-25T23:59:59+09:00',
      employmentTypes: ['contract'],
      url: 'https://www.gojobs.go.kr/apmView.do?menuNo=401&mngrMenuYn=N&selMenuNo=400&upperMenuNo=&empmnsn=308586',
    })
  })

  it('extracts gojobs-search-p2 with central agencies ([]) and regional universities ([강원])', () => {
    const page = extractPage(gojobs, fixture('gojobs-search-p2.html'))

    expect(page.postings).toHaveLength(10)
    expect(page.totalPages).toBe(147)
    expect(page.postings[0]).toMatchObject({
      externalId: '306552',
      company: '병무청',
      locations: [],
      postedAt: '2026-10-23T00:00:00+09:00',
      deadline: '2026-11-03T23:59:59+09:00',
    })
    expect(page.postings[1]).toMatchObject({
      externalId: '306518',
      company: '강원대학교',
      locations: ['강원'],
    })
  })

  it('returns empty postings for td.emptyRow and throws when #apmTbl is missing', () => {
    const emptyHtml = '<table id="apmTbl"><tbody><tr><td class="emptyRow">자료가 없습니다.</td></tr></tbody></table>'
    expect(extractPage(gojobs, emptyHtml).postings).toEqual([])
    expect(() => extractPage(gojobs, '<html><body>error</body></html>')).toThrow(/gojobs/)
  })
})
