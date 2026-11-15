import { useState } from 'react'

interface Props {
  memo: string
  onSave: (memo: string) => void
}

export function MemoField({ memo, onSave }: Props) {
  const [draft, setDraft] = useState(memo)

  const commit = () => {
    const next = draft.trim()
    setDraft(next)
    if (next !== memo) onSave(next)
  }

  return (
    <input
      className="memo-input"
      aria-label="메모"
      value={draft}
      placeholder="메모 입력 (Enter로 저장)"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
    />
  )
}
