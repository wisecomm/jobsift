import type { PostingStatus, UserStatus } from '../shared/types'
import type { StatusTab } from './selectPostings'

export const STATUS_TABS: readonly { status: StatusTab; label: string }[] = [
  { status: 'new', label: '신규' },
  { status: 'saved', label: '관심' },
  { status: 'applied', label: '지원완료' },
  { status: 'dismissed', label: '확인완료' },
  { status: 'expired', label: '마감' },
  { status: 'all', label: '전체' },
]

export const STATUS_LABEL: Record<PostingStatus, string> = {
  new: '신규',
  saved: '관심',
  applied: '지원완료',
  dismissed: '확인완료',
  expired: '마감',
}

const ACTIONS: readonly { to: UserStatus; label: string; backLabel?: string }[] = [
  { to: 'saved', label: '관심' },
  { to: 'applied', label: '지원완료' },
  { to: 'dismissed', label: '확인완료' },
  { to: 'new', label: '신규로 되돌리기' },
]

/** Every state a posting can move to by hand, except the one it is in. An expired posting has none. */
export function actionsFor(status: PostingStatus): { to: UserStatus; label: string }[] {
  return status === 'expired' ? [] : ACTIONS.filter((a) => a.to !== status)
}
