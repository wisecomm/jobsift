import type { EmploymentType } from './types'

export const EMPLOYMENT_TYPE_OPTIONS: readonly { value: EmploymentType; label: string }[] = [
  { value: 'regular', label: '정규직' },
  { value: 'contract', label: '계약직' },
  { value: 'intern', label: '인턴' },
  { value: 'dispatch', label: '파견·도급' },
  { value: 'freelance', label: '프리랜서·위촉' },
  { value: 'partTime', label: '아르바이트' },
]

export const EMPLOYMENT_TYPE_LABELS: Record<EmploymentType, string> = {
  regular: '정규직',
  contract: '계약직',
  intern: '인턴',
  dispatch: '파견·도급',
  freelance: '프리랜서·위촉',
  partTime: '아르바이트',
  other: '기타',
}

export function employmentTypesLabel(types: readonly EmploymentType[] | undefined): string {
  if (!types || types.length === 0) return '고용형태 정보 없음'
  return types.map((t) => EMPLOYMENT_TYPE_LABELS[t] ?? t).join('·')
}

function classifyToken(token: string): EmploymentType | null {
  if (token.includes('무기계약') || token.includes('공무직')) return 'regular'
  if (token.includes('비정규') || token.includes('계약') || token.includes('기간제') || token.includes('임기제')) return 'contract'
  if (token.includes('정규직') || token === '정규') return 'regular'
  if (token.includes('인턴')) return 'intern'
  if (token.includes('파견') || token.includes('도급')) return 'dispatch'
  if (token.includes('프리랜서') || token.includes('위촉') || token.includes('개인사업')) return 'freelance'
  if (token.includes('아르바이트') || token.includes('알바')) return 'partTime'
  if (token.includes('연수') || token.includes('교육생') || token.includes('병역')) return 'other'
  return null
}

/** Parses one or more employment labels separated by middots, commas, or slashes. */
export function parseEmploymentText(raw: string): EmploymentType[] {
  const found: EmploymentType[] = []
  const tokens = raw
    .split(/[·,/|]+/)
    .map((s) => s.replace(/\s+/g, '').trim())
    .filter(Boolean)
  for (const token of tokens) {
    const type = classifyToken(token)
    if (type && !found.includes(type)) found.push(type)
  }
  return found
}

/** Infers employment types explicitly named in a posting title (for sites without a dedicated column). */
export function inferEmploymentFromTitle(title: string): EmploymentType[] {
  const compact = title.replace(/\s+/g, '')
  const found: EmploymentType[] = []
  const add = (type: EmploymentType) => {
    if (!found.includes(type)) found.push(type)
  }
  if (/무기계약|공무직|(?<!비)정규직/.test(compact)) add('regular')
  const withoutPermanent = compact.replace(/무기계약/g, '')
  if (/비정규|계약직|기간제|임기제/.test(withoutPermanent)) add('contract')
  if (/인턴/.test(compact)) add('intern')
  if (/파견직/.test(compact)) add('dispatch')
  if (/프리랜서|위촉직/.test(compact)) add('freelance')
  return found
}
