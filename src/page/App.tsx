import { useCallback, useEffect, useState } from 'react'
import type { AiInput } from '../ai/settings'
import type { AiSettingsView, CollectionSummary, PostingKey, PostingPatch, ScoringSummary, SearchCriteria, StoredPosting } from '../shared/types'
import { send, updatePosting } from './api'
import { Header } from './Header'
import { PostingsView } from './PostingsView'
import { SettingsView } from './SettingsView'

type Tab = 'postings' | 'settings'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function App() {
  const [tab, setTab] = useState<Tab | null>(null)
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null)
  const [postings, setPostings] = useState<StoredPosting[]>([])
  const [ai, setAi] = useState<AiSettingsView | null>(null)
  const [pending, setPending] = useState(0)
  const [summary, setSummary] = useState<CollectionSummary | null>(null)
  const [scoring, setScoring] = useState<ScoringSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [saved, savedAi, list, waiting] = await Promise.all([
          send({ type: 'getCriteria' }),
          send({ type: 'getAiSettings' }),
          send({ type: 'listPostings' }),
          send({ type: 'pendingCount' }),
        ])
        setCriteria(saved)
        setAi(savedAi)
        setPostings(list)
        setPending(waiting)
        setTab(saved.keywords.length === 0 ? 'settings' : 'postings')
      } catch (e) {
        setError(errorText(e))
      }
    })()
  }, [])

  const refresh = useCallback(async () => {
    const [list, waiting] = await Promise.all([send({ type: 'listPostings' }), send({ type: 'pendingCount' })])
    setPostings(list)
    setPending(waiting)
  }, [])

  async function work(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await task()
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  const collectNow = () =>
    work(async () => {
      const result = await send({ type: 'collect' })
      setSummary(result)
      setScoring(result.scoring)
    })

  const scoreWaiting = () =>
    work(async () => {
      setScoring(await send({ type: 'scorePending' }))
    })

  async function reloadSettings() {
    setCriteria(await send({ type: 'getCriteria' }))
    setAi(await send({ type: 'getAiSettings' }))
    await refresh()
  }

  const removedNote = (removed: number) => (removed > 0 ? ` 조건에 맞지 않는 공고 ${removed}건을 제외했습니다.` : '')
  const queuedNote = (queued: number) => (queued > 0 ? ` 채점 대기 ${queued}건은 "대기 공고 채점"을 누르면 채점합니다.` : '')

  async function saveSettings(next: SearchCriteria, nextAi: AiInput): Promise<string> {
    const { changed, removed, queued } = await send({ type: 'saveSettings', criteria: next, ai: nextAi })
    await reloadSettings()
    return changed ? `설정을 저장했습니다.${removedNote(removed)}${queuedNote(queued)}` : '설정을 저장했습니다.'
  }

  async function deleteKey(): Promise<string> {
    const { removed } = await send({ type: 'deleteAiKey' })
    await reloadSettings()
    return `키를 삭제했습니다. 이제 키워드 규칙만으로 공고를 모읍니다.${removedNote(removed)}`
  }

  async function checkKey(apiKey: string, model: string): Promise<string> {
    const result = await send({ type: 'checkAiKey', apiKey, model })
    if (!result.ok) throw new Error(result.message)
    return '키가 정상적으로 동작합니다.'
  }

  async function devReset() {
    setSummary(await send({ type: 'devReset' }))
    await refresh()
  }

  async function patchPosting(key: PostingKey, patch: PostingPatch) {
    setError(null)
    try {
      const updated = await updatePosting(key, patch)
      setPostings((all) => all.map((p) => (p.site === key.site && p.externalId === key.externalId ? updated : p)))
    } catch (e) {
      setError(errorText(e))
      await refresh()
    }
  }

  const hasCriteria = (criteria?.keywords.length ?? 0) > 0

  return (
    <div className="app">
      <Header busy={busy} canCollect={hasCriteria} summary={summary} scoring={scoring} pending={pending} onCollect={() => void collectNow()} onScorePending={() => void scoreWaiting()} />
      {error && (
        <p role="alert" className="banner warn">
          오류: {error}
        </p>
      )}
      {tab && criteria && ai && (
        <>
          <nav className="main-tabs" aria-label="화면">
            <button type="button" aria-current={tab === 'postings' ? 'page' : undefined} onClick={() => setTab('postings')}>
              공고
            </button>
            <button type="button" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>
              조건 설정
            </button>
          </nav>
          <main>
            <div hidden={tab !== 'postings'}>
              <PostingsView postings={postings} hasCriteria={hasCriteria} onUpdate={(k, p) => void patchPosting(k, p)} onOpenSettings={() => setTab('settings')} />
            </div>
            <div hidden={tab !== 'settings'}>
              <SettingsView criteria={criteria} ai={ai} onSave={saveSettings} onDeleteKey={deleteKey} onCheckKey={checkKey} onDevReset={devReset} />
            </div>
          </main>
        </>
      )}
    </div>
  )
}
