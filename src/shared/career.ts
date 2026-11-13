import type { Career } from './types'

export function careerLabel(career: Career): string {
  switch (career.kind) {
    case 'new':
      return '신입'
    case 'any':
      return '경력무관'
    case 'experienced':
      return career.minYears ? `경력 ${career.minYears}년↑` : '경력'
    case 'newOrExperienced':
      return career.minYears ? `신입·경력 ${career.minYears}년↑` : '신입·경력'
    case 'unknown':
      return '경력 정보 없음'
  }
}
