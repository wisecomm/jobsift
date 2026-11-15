import { describe, expect, it } from 'vitest'
import { criteriaChanged, parseCriteria } from '../src/engine/criteria'
import { employmentTypesLabel, inferEmploymentFromTitle, parseEmploymentText } from '../src/shared/employment'
import { criteria } from './helpers'

describe('employment utilities', () => {
  it('parses JobKorea display names and Saramin combined spans', () => {
    expect(parseEmploymentText('정규직')).toEqual(['regular'])
    expect(parseEmploymentText('정규직·계약직')).toEqual(['regular', 'contract'])
    expect(parseEmploymentText('기간제·계약직')).toEqual(['contract'])
    expect(parseEmploymentText('무기계약직·계약직')).toEqual(['regular', 'contract'])
    expect(parseEmploymentText('파견직·도급')).toEqual(['dispatch'])
    expect(parseEmploymentText('프리랜서·위촉직/개인사업자')).toEqual(['freelance'])
    expect(parseEmploymentText('인턴·아르바이트')).toEqual(['intern', 'partTime'])
    expect(parseEmploymentText('연수생/교육생')).toEqual(['other'])
  })

  it('infers employment types from Gojobs titles when stated', () => {
    expect(inferEmploymentFromTitle('시간선택제임기제공무원 채용')).toEqual(['contract'])
    expect(inferEmploymentFromTitle('기간제 근로자(전산) 채용공고')).toEqual(['contract'])
    expect(inferEmploymentFromTitle('일반임기제 전산주사보 채용')).toEqual(['contract'])
    expect(inferEmploymentFromTitle('청년인턴 채용 공고')).toEqual(['intern'])
    expect(inferEmploymentFromTitle('공무직 근로자 채용')).toEqual(['regular'])
    expect(inferEmploymentFromTitle('전산직 7급 경력경쟁채용')).toEqual([])
  })

  it('formats employment types for cards', () => {
    expect(employmentTypesLabel(undefined)).toBe('고용형태 정보 없음')
    expect(employmentTypesLabel([])).toBe('고용형태 정보 없음')
    expect(employmentTypesLabel(['regular', 'contract'])).toBe('정규직·계약직')
  })

  it('defaults missing employmentTypes in stored criteria and detects changes', () => {
    const legacy = parseCriteria({ keywords: ['전산'], locations: ['서울'], career: 'any', description: '' })
    expect(legacy.employmentTypes).toEqual([])
    expect(criteriaChanged(criteria({ employmentTypes: ['regular'] }), criteria({ employmentTypes: ['contract'] }))).toBe(true)
    expect(criteriaChanged(criteria({ employmentTypes: ['regular', 'contract'] }), criteria({ employmentTypes: ['contract', 'regular'] }))).toBe(false)
  })
})
