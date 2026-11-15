import { describe, expect, it } from 'vitest'
import { evaluate } from '../src/engine/evaluate'
import { criteria, posting } from './helpers'

const NOW = new Date('2026-11-13T20:00:00+09:00')

describe('evaluate', () => {
  it('passes and reports the matched keywords', () => {
    const result = evaluate(posting({ title: '전산 회계 담당' }), criteria({ keywords: ['전산', '회계', '영업'] }), NOW)
    expect(result).toEqual({ kind: 'pass', matchedKeywords: ['전산', '회계'] })
  })

  it('rejects a posting whose deadline has passed', () => {
    const result = evaluate(posting({ deadline: '2026-11-13T19:59:00+09:00' }), criteria(), NOW)
    expect(result).toEqual({ kind: 'reject', reason: { gate: 'expired' } })
  })

  it('keeps a posting with a future or no deadline', () => {
    expect(evaluate(posting({ deadline: '2026-11-14T00:00:00+09:00' }), criteria(), NOW).kind).toBe('pass')
    expect(evaluate(posting({ deadline: null }), criteria(), NOW).kind).toBe('pass')
  })

  it('rejects when no keyword is in the title or tags', () => {
    const result = evaluate(posting({ title: '회계 담당', jobTags: ['전산회계 2급'] }), criteria({ keywords: ['개발'] }), NOW)
    expect(result).toEqual({ kind: 'reject', reason: { gate: 'keywordMismatch' } })
  })

  it('does not apply the keyword gate when switched off, and still reports matches', () => {
    const p = posting({ title: '회계 담당', jobTags: [] })
    const off = { requireKeywordMatch: false }
    expect(evaluate(p, criteria({ keywords: ['개발'] }), NOW, off)).toEqual({ kind: 'pass', matchedKeywords: [] })
    expect(evaluate(p, criteria({ keywords: ['회계'] }), NOW, off)).toEqual({ kind: 'pass', matchedKeywords: ['회계'] })
  })

  it('reports the first failing gate in order', () => {
    const p = posting({ title: '회계', deadline: '2026-01-01T00:00:00+09:00', locations: ['부산'], career: { kind: 'experienced', minYears: 3 } })
    const c = criteria({ keywords: ['전산'], locations: ['서울'], career: 'new' })
    expect(evaluate(p, c, NOW)).toEqual({ kind: 'reject', reason: { gate: 'expired' } })
    expect(evaluate({ ...p, deadline: null }, c, NOW)).toEqual({ kind: 'reject', reason: { gate: 'keywordMismatch' } })
    expect(evaluate({ ...p, deadline: null, title: '전산' }, c, NOW)).toEqual({ kind: 'reject', reason: { gate: 'location' } })
    expect(evaluate({ ...p, deadline: null, title: '전산', locations: ['서울'] }, c, NOW)).toEqual({ kind: 'reject', reason: { gate: 'career' } })
  })

  describe('keyword matching', () => {
    const matches = (keyword: string, title: string) =>
      evaluate(posting({ title, jobTags: [] }), criteria({ keywords: [keyword] }), NOW).kind === 'pass'

    it('does not let an ASCII keyword sit inside another English word', () => {
      expect(matches('IT', 'website 관리')).toBe(false)
      expect(matches('IT', 'work with us')).toBe(false)
      expect(matches('IT', 'IT 지원')).toBe(true)
      expect(matches('IT', '사내IT담당')).toBe(true)
      expect(matches('it', 'IT-인프라')).toBe(true)
    })

    it('treats + # . as part of an ASCII keyword', () => {
      expect(matches('C++', 'C++ 개발자')).toBe(true)
      expect(matches('C#', '신입 C# 개발')).toBe(true)
      expect(matches('C', 'Cloud')).toBe(false)
    })

    it('matches Korean keywords as plain substrings', () => {
      expect(matches('전산', '전산회계 2급 우대')).toBe(true)
      expect(matches('회계', '전산 담당')).toBe(false)
    })

    it('ignores keywords that only appear inside the company name in the title', () => {
      const gov = posting({
        company: '한국건강증진개발원',
        title: '한국건강증진개발원 2026년 개방형직위(전략경영본부장) 공모',
        jobTags: [],
      })
      expect(evaluate(gov, criteria({ keywords: ['개발'] }), NOW)).toEqual({ kind: 'reject', reason: { gate: 'keywordMismatch' } })
      expect(evaluate(gov, criteria({ keywords: ['개발'] }), NOW, { requireKeywordMatch: false })).toEqual({ kind: 'pass', matchedKeywords: [] })

      const realDev = posting({
        company: '(주)한국건강증진개발원',
        title: '한국건강증진개발원 백엔드 개발자 채용',
        jobTags: [],
      })
      expect(evaluate(realDev, criteria({ keywords: ['개발'] }), NOW)).toEqual({ kind: 'pass', matchedKeywords: ['개발'] })
    })
  })

  describe('location', () => {
    const pass = (locations: string[], preferred: string[]) =>
      evaluate(posting({ locations }), criteria({ locations: preferred }), NOW).kind === 'pass'

    it('does not restrict when no preference is set', () => {
      expect(pass(['부산>해운대구'], [])).toBe(true)
    })

    it('matches on the top-level region only', () => {
      expect(pass(['서울>강남구'], ['서울'])).toBe(true)
      expect(pass(['서울>강남구'], ['경기'])).toBe(false)
      expect(pass(['경기>서울대입구'], ['서울'])).toBe(false)
    })

    it('matches a region that starts with the preferred name', () => {
      expect(pass(['서울특별시>강남구'], ['서울'])).toBe(true)
    })

    it('passes a posting with no locations and any matching location of several', () => {
      expect(pass([], ['서울'])).toBe(true)
      expect(pass(['부산', '서울>중구'], ['서울'])).toBe(true)
    })
  })

  describe('career', () => {
    const kinds = {
      new: { kind: 'new' },
      any: { kind: 'any' },
      experienced: { kind: 'experienced', minYears: 3 },
      newOrExperienced: { kind: 'newOrExperienced', minYears: null },
      unknown: { kind: 'unknown' },
    } as const
    const verdict = (filter: 'any' | 'new' | 'experienced', kind: keyof typeof kinds) =>
      evaluate(posting({ career: kinds[kind] }), criteria({ career: filter }), NOW).kind

    it('new rejects only experienced postings', () => {
      expect(Object.keys(kinds).filter((k) => verdict('new', k as keyof typeof kinds) === 'reject')).toEqual(['experienced'])
    })

    it('experienced rejects only new postings', () => {
      expect(Object.keys(kinds).filter((k) => verdict('experienced', k as keyof typeof kinds) === 'reject')).toEqual(['new'])
    })

    it('any rejects nothing', () => {
      expect(Object.keys(kinds).filter((k) => verdict('any', k as keyof typeof kinds) === 'reject')).toEqual([])
    })
  })
})
