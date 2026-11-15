import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiInput } from '../ai/settings'
import { LAST_SITE_MESSAGE, moveSite, setSiteKeywords, setSiteMaxItems, toggleSite } from '../engine/siteSettings'
import type { SiteSettingsView } from '../shared/messages'
import type { AiSettingsView, AiUsageRecord, CollectionReport, PostingKey, PostingPatch, ScoringSummary, SearchCriteria, StoredPosting } from '../shared/types'
import { send, updatePosting } from './api'
import { DEFAULT_BATCH_HOURS, clampBatchHours, nextBatchRunAt, shouldTriggerBatch } from './batchSchedule'
import { NO_AI_COLLECT_CONFIRM } from './format'
import { Header } from './Header'
import { PostingsView } from './PostingsView'
import { SettingsView } from './SettingsView'
import { SitesView } from './SitesView'
import { SITES_TAB_LABEL } from './sites'

type Tab = 'postings' | 'settings' | 'sites'

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))

export function App() {
  const [tab, setTab] = useState<Tab | null>(null)
  const [criteria, setCriteria] = useState<SearchCriteria | null>(null)
  const [postings, setPostings] = useState<StoredPosting[]>([])
  const [ai, setAi] = useState<AiSettingsView | null>(null)
  const [aiUsage, setAiUsage] = useState<AiUsageRecord | null>(null)
  const [pending, setPending] = useState(0)
  const [sites, setSites] = useState<SiteSettingsView | null>(null)
  const [report, setReport] = useState<CollectionReport | null>(null)
  const [scoring, setScoring] = useState<ScoringSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [progress, setProgress] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [batchEnabled, setBatchEnabled] = useState(false)
  const [batchHours, setBatchHours] = useState(DEFAULT_BATCH_HOURS)
  const [nextBatchAt, setNextBatchAt] = useState<number | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const [saved, savedAi, usage, list, waiting, siteState] = await Promise.all([
          send({ type: 'getCriteria' }),
          send({ type: 'getAiSettings' }),
          send({ type: 'getAiUsage' }),
          send({ type: 'listPostings' }),
          send({ type: 'pendingCount' }),
          send({ type: 'getSiteSettings' }),
        ])
        if (usage === undefined) {
          setError('확장 프로그램 백그라운드가 이전 버전입니다. chrome://extensions에서 확장 프로그램을 새로고침(↻)한 뒤 이 탭도 새로고침해 주세요.')
        }
        setSites(siteState)
        setCriteria(saved)
        setAi(savedAi)
        setAiUsage(usage ?? null)
        setPostings(list)
        setPending(waiting)
        setTab(
          saved.keywords.length === 0 && !siteState.settings.enabledSites.some((id) => (siteState.settings.keywordsBySite?.[id]?.length ?? 0) > 0)
            ? 'settings'
            : 'postings',
        )
      } catch (e) {
        setError(errorText(e))
      }
    })()
  }, [])

  const refresh = useCallback(async () => {
    const [list, waiting, siteState, usage] = await Promise.all([
      send({ type: 'listPostings' }),
      send({ type: 'pendingCount' }),
      send({ type: 'getSiteSettings' }),
      send({ type: 'getAiUsage' }),
    ])
    setPostings(list)
    setPending(waiting)
    setSites(siteState)
    setAiUsage(usage)
  }, [])

  const refreshPromiseRef = useRef<Promise<void> | null>(null)
  const refreshNeededRef = useRef(false)

  const scheduleRefresh = useCallback(() => {
    refreshNeededRef.current = true
    if (refreshPromiseRef.current) return refreshPromiseRef.current
    const loop = (async () => {
      try {
        while (refreshNeededRef.current) {
          refreshNeededRef.current = false
          await refresh()
        }
      } finally {
        refreshPromiseRef.current = null
      }
    })()
    refreshPromiseRef.current = loop
    return loop
  }, [refresh])

  const syncLive = () => {
    void scheduleRefresh().catch(() => undefined)
  }

  async function work(task: () => Promise<void>) {
    setBusy(true)
    setProgress(null)
    setError(null)
    let taskFailed = false
    try {
      await task()
    } catch (e) {
      taskFailed = true
      setError(errorText(e))
    } finally {
      try {
        await scheduleRefresh()
      } catch (e) {
        if (!taskFailed) setError(errorText(e))
      }
      setProgress(null)
      setBusy(false)
    }
  }

  const confirmWithoutAi = () => !ai || ai.hasKey || window.confirm(NO_AI_COLLECT_CONFIRM)

  const runCollectAll = () =>
    work(async () => {
      const result = await send({ type: 'collect' }, setProgress, syncLive)
      setReport(result)
      setScoring(result.scoring)
    })

  const collectNow = () => {
    if (!confirmWithoutAi()) return Promise.resolve()
    return runCollectAll()
  }

  const collectSite = (site: string) => {
    if (!confirmWithoutAi()) return Promise.resolve()
    return work(async () => {
      const result = await send({ type: 'collect', site }, setProgress, syncLive)
      setReport(result)
      setScoring(result.scoring)
    })
  }

  const continueCollect = (site: string, keyword?: string) => {
    if (!confirmWithoutAi()) return Promise.resolve()
    return work(async () => {
      const result = await send({ type: 'collect', site, keyword, continueFromCap: true }, setProgress, syncLive)
      setReport(result)
      setScoring(result.scoring)
    })
  }

  async function persistSiteSettings(next: NonNullable<typeof sites>['settings']) {
    if (!sites) return
    const settings = await send({
      type: 'saveSiteSettings',
      enabledSites: next.enabledSites,
      siteOrder: next.siteOrder,
      maxItemsBySite: next.maxItemsBySite,
      keywordsBySite: next.keywordsBySite ?? {},
    })
    setSites({ ...sites, settings })
  }

  async function toggleSiteOn(id: string, on: boolean) {
    if (!sites) return
    const next = toggleSite(sites.settings, id, on)
    if (next.kind === 'last-site') throw new Error(LAST_SITE_MESSAGE)
    await persistSiteSettings(next.settings)
  }

  async function moveSiteOrder(id: string, direction: 'up' | 'down') {
    if (!sites) return
    const next = moveSite(sites.settings, id, direction)
    if (next !== sites.settings) await persistSiteSettings(next)
  }

  async function updateSiteMaxItems(id: string, maxItems: number) {
    if (!sites) return
    await persistSiteSettings(setSiteMaxItems(sites.settings, id, maxItems))
  }

  async function updateSiteKeywords(id: string, keywords: string[]) {
    if (!sites) return
    await persistSiteSettings(setSiteKeywords(sites.settings, id, keywords))
    await refresh()
  }

  const scoreWaiting = () =>
    work(async () => {
      setScoring(await send({ type: 'scorePending' }, setProgress, syncLive))
    })

  async function reloadSettings() {
    setCriteria(await send({ type: 'getCriteria' }))
    setAi(await send({ type: 'getAiSettings' }))
    await refresh()
  }

  const removedNote = (removed: number) => (removed > 0 ? ` 조건에 맞지 않는 대기 공고 ${removed}건을 제외했습니다.` : '')
  const queuedNote = (queued: number) => (queued > 0 ? ` 채점 대기 ${queued}건은 "대기 공고 채점"을 누르면 채점합니다.` : '')

  async function saveSettings(next: SearchCriteria, nextAi: AiInput): Promise<string> {
    const { changed, removed, queued } = await send({ type: 'saveSettings', criteria: next, ai: nextAi })
    await reloadSettings()
    return changed ? `설정을 저장했습니다. 다음 수집부터 새 조건이 적용됩니다.${removedNote(removed)}${queuedNote(queued)}` : '설정을 저장했습니다.'
  }

  async function deleteKey(provider: NonNullable<typeof ai>['provider']): Promise<string> {
    const { removed } = await send({ type: 'deleteAiKey', provider })
    await reloadSettings()
    const label = provider === 'exaone' ? 'EXAONE' : 'Gemini'
    return `${label} 키를 삭제했습니다.${removedNote(removed)}`
  }

  async function checkKey(provider: NonNullable<typeof ai>['provider'], apiKey: string, model: string): Promise<string> {
    const result = await send({ type: 'checkAiKey', provider, apiKey, model })
    if (!result.ok) throw new Error(result.message)
    return '키가 정상적으로 동작합니다.'
  }

  async function clearUsage(): Promise<string> {
    setAiUsage(await send({ type: 'clearAiUsage' }))
    return '누적 토큰 사용량 기록을 초기화했습니다.'
  }

  const resetCollect = () =>
    work(async () => {
      setPostings([])
      setPending(0)
      setReport(null)
      setScoring(null)
      const result = await send({ type: 'resetCollect' }, setProgress, syncLive)
      setReport(result)
      setScoring(result.scoring)
    })

  const cancelWork = () => {
    setProgress('중단 요청 중…')
    void send({ type: 'cancelWork' }).catch(() => undefined)
  }

  async function patchPosting(key: PostingKey, patch: PostingPatch) {
    setError(null)
    try {
      const updated = await updatePosting(key, patch)
      setPostings((all) => all.map((p) => (p.site === key.site && p.externalId === key.externalId ? updated : p)))
      if (refreshPromiseRef.current) syncLive()
    } catch (e) {
      setError(errorText(e))
      await refresh()
    }
  }

  const hasCriteria =
    (criteria?.keywords.length ?? 0) > 0 ||
    (sites?.settings.enabledSites.some((id) => (sites.settings.keywordsBySite?.[id]?.length ?? 0) > 0) ?? false)
  const collectNowRef = useRef(runCollectAll)
  collectNowRef.current = runCollectAll
  const wasBusyRef = useRef(false)

  const toggleBatch = (enabled: boolean) => {
    if (
      enabled &&
      ai &&
      !ai.hasKey &&
      !window.confirm('AI 채점을 사용하지 않습니다(API 키 없음). 자동 배치가 키워드·지역·경력 규칙만으로 수집합니다. 계속 켤까요?')
    ) {
      return
    }
    setBatchEnabled(enabled)
    setNextBatchAt(enabled ? nextBatchRunAt(Date.now(), batchHours) : null)
  }

  const changeBatchHours = (raw: number) => {
    const hours = clampBatchHours(raw)
    setBatchHours(hours)
    if (batchEnabled) setNextBatchAt(nextBatchRunAt(Date.now(), hours))
  }

  useEffect(() => {
    const finishedRun = wasBusyRef.current && !busy
    wasBusyRef.current = busy
    if (finishedRun && batchEnabled) setNextBatchAt(nextBatchRunAt(Date.now(), batchHours))
  }, [busy, batchEnabled, batchHours])

  useEffect(() => {
    if (!batchEnabled || !hasCriteria || busy) return
    const check = () => {
      if (shouldTriggerBatch({ enabled: batchEnabled, busy, canCollect: hasCriteria, nowMs: Date.now(), nextRunAt: nextBatchAt })) {
        setNextBatchAt(nextBatchRunAt(Date.now(), batchHours))
        void collectNowRef.current()
      }
    }
    const id = window.setInterval(check, 15_000)
    document.addEventListener('visibilitychange', check)
    return () => {
      window.clearInterval(id)
      document.removeEventListener('visibilitychange', check)
    }
  }, [batchEnabled, batchHours, busy, hasCriteria, nextBatchAt])

  return (
    <div className="app">
      <Header
        busy={busy}
        canCollect={hasCriteria}
        ai={ai}
        progress={progress}
        report={report}
        scoring={scoring}
        pending={pending}
        resumableBySite={sites?.resumableBySite}
        batchEnabled={batchEnabled}
        batchHours={batchHours}
        nextBatchAt={nextBatchAt}
        onToggleBatch={toggleBatch}
        onChangeBatchHours={changeBatchHours}
        onCollect={() => void collectNow()}
        onContinueCollect={(site, keyword) => void continueCollect(site, keyword)}
        onResetCollect={() => void resetCollect()}
        onScorePending={() => void scoreWaiting()}
        onCancel={cancelWork}
      />
      {error && (
        <p role="alert" className="banner warn">
          오류: {error}
        </p>
      )}
      {tab && criteria && ai && sites && (
        <>
          <nav className="main-tabs" aria-label="화면">
            <button type="button" aria-current={tab === 'postings' ? 'page' : undefined} onClick={() => setTab('postings')}>
              공고
            </button>
            <button type="button" aria-current={tab === 'settings' ? 'page' : undefined} onClick={() => setTab('settings')}>
              조건 설정
            </button>
            <button type="button" aria-current={tab === 'sites' ? 'page' : undefined} onClick={() => setTab('sites')}>
              {SITES_TAB_LABEL}
            </button>
          </nav>
          <main>
            <div hidden={tab !== 'postings'}>
              <PostingsView postings={postings} hasCriteria={hasCriteria} siteOrder={sites.settings.siteOrder} onUpdate={(k, p) => void patchPosting(k, p)} onOpenSettings={() => setTab('settings')} />
            </div>
            <div hidden={tab !== 'settings'}>
              <SettingsView
                criteria={criteria}
                ai={ai}
                aiUsage={aiUsage}
                onSave={saveSettings}
                onDeleteKey={deleteKey}
                onCheckKey={checkKey}
                onClearAiUsage={clearUsage}
              />
            </div>
            <div hidden={tab !== 'sites'}>
              <SitesView
                state={sites}
                busy={busy}
                canCollect={hasCriteria}
                onToggle={toggleSiteOn}
                onMove={moveSiteOrder}
                onUpdateMaxItems={updateSiteMaxItems}
                onUpdateKeywords={updateSiteKeywords}
                onCollectSite={(id) => void collectSite(id)}
                onContinueSite={(id, keyword) => void continueCollect(id, keyword)}
              />
            </div>
          </main>
        </>
      )}
    </div>
  )
}
