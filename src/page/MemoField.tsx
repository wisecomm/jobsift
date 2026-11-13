import { useState } from 'react'

interface Props {
  memo: string
  onSave: (memo: string) => void
}

export function MemoField({ memo, onSave }: Props) {
  const [draft, setDraft] = useState(memo)
  const [open, setOpen] = useState(false)

  if (!open && memo === '') {
    return (
      <button type="button" className="link" onClick={() => setOpen(true)}>
        + 메모 추가
      </button>
    )
  }

  const commit = () => {
    const next = draft.trim()
    setDraft(next)
    if (next !== memo) onSave(next)
    if (next === '') setOpen(false)
  }

  return (
    <label className="memo">
      <span>메모</span>
      <input
        value={draft}
        autoFocus={open && memo === ''}
        placeholder="이 공고에 대한 메모"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
      />
    </label>
  )
}
