import { useCallback, useEffect, useState } from 'react'
import type { CollectionSummary, PostingKey, PostingPatch, SearchCriteria, StoredPosting } from '../shared/types'
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
  const [summary, setSummary] = useState<CollectionSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [saved, list] = await Promise.all([send({ type: 'getCriteria' }), send({ type: 'listPostings' })])
        setCriteria(saved)
        setPostings(list)
        setTab(saved.keywords.length === 0 ? 'settings' : 'postings')
      } catch (e) {
        setError(errorText(e))
      }
    })()
  }, [])

  const refresh = useCallback(async () => setPostings(await send({ type: 'listPostings' })), [])

  async function collectNow() {
    setBusy(true)
    setError(null)
    try {
      setSummary(await send({ type: 'collect' }))
      await refresh()
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveCriteria(next: SearchCriteria): Promise<string> {
    const { changed, removed } = await send({ type: 'saveCriteria', criteria: next })
    setCriteria(await send({ type: 'getCriteria' }))
    await refresh()
    return changed ? `조건을 저장했습니다 (대기 공고 ${removed}건 제외)` : '조건을 저장했습니다'
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
      <Header busy={busy} canCollect={hasCriteria} summary={summary} onCollect={() => void collectNow()} />
      {error && (
        <p role="alert" className="banner warn">
          오류: {error}
        </p>
      )}
      {tab && criteria && (
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
              <SettingsView criteria={criteria} onSave={saveCriteria} onDevReset={devReset} />
            </div>
          </main>
        </>
      )}
    </div>
  )
}
