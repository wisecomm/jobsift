import { adapterIds, adapters } from '../adapter/registry'
import { EXAONE_REQUEST_GAP_MS, REQUEST_GAP_MS } from '../ai/constants'
import { formatAiError } from '../ai/parseScores'
import { checkProviderKey, scoreWithProvider } from '../ai/provider'
import { createPacer } from '../ai/pacer'
import { buildInstruction } from '../ai/prompt'
import {
  aiEnabled,
  clearProviderKey,
  loadAiSettings,
  mergeAiInput,
  normalizeAiSettings,
  providerKey,
  resolvedProvider,
  settingsChanged,
  storeAiSettings,
  toAiView,
  type SettingsSnapshot,
} from '../ai/settings'
import { clearAiUsage, emptyAiUsage, loadAiUsage, recordAiUsage } from '../ai/usage'
import { applyCriteriaChange } from '../engine/applyCriteriaChange'
import { normalizeCriteria, parseCriteria } from '../engine/criteria'
import { runAllSites } from '../engine/runAllSites'
import { scorePending, toScoringSummary, type ScoringDeps } from '../engine/scorePending'
import { addSiteRunUsage, clearSiteRuns, loadSiteRuns, recordSiteRuns } from '../engine/siteRuns'
import {
  keywordsBySiteChanged,
  LAST_SITE_MESSAGE,
  loadSiteSettings,
  parseSiteSettings,
  selectAdaptersForRun,
  siteKeywords,
  siteMaxItems,
  storeSiteSettings,
} from '../engine/siteSettings'
import type { Request, ResponseData, ResponseFor, SettingsResult } from '../shared/messages'
import type { SearchCriteria, SiteSettings } from '../shared/types'
import { openStore, type Store } from '../storage/store'

const CRITERIA_KEY = 'criteria'
const storePromise = openStore()

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/page/index.html') })
})

const PAGE_TIMEOUT_MS = 30_000

function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise((resolve) => {
    const onAbort = () => {
      clearTimeout(timer)
      resolve()
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)
    signal?.addEventListener('abort', onAbort, { once: true })
  })
}

// A site that holds the connection open must fail this keyword, not freeze every site behind it.
async function fetchHtml(url: string, signal?: AbortSignal): Promise<string> {
  const combined = signal ? AbortSignal.any([AbortSignal.timeout(PAGE_TIMEOUT_MS), signal]) : AbortSignal.timeout(PAGE_TIMEOUT_MS)
  try {
    const response = await fetch(url, { credentials: 'omit', signal: combined })
    if (!response.ok) throw new Error(`요청 실패 (${response.status}): ${url}`)
    return await response.text()
  } catch (error) {
    if (signal?.aborted) throw new Error('수집이 중단되었습니다.')
    if (error instanceof DOMException && error.name === 'TimeoutError') {
      throw new Error(`${PAGE_TIMEOUT_MS / 1000}초 안에 응답이 없어 이 키워드 수집을 멈췄습니다: ${new URL(url).host}`)
    }
    throw error
  }
}

async function readCriteria(): Promise<SearchCriteria> {
  const stored = await chrome.storage.local.get(CRITERIA_KEY)
  return parseCriteria(stored[CRITERIA_KEY])
}

const KEEPALIVE_MS = 20_000

function keepServiceWorkerAlive(): () => void {
  const id = setInterval(() => {
    chrome.runtime.getPlatformInfo(() => void chrome.runtime.lastError)
  }, KEEPALIVE_MS)
  return () => clearInterval(id)
}

// One writer at a time: a criteria save must not interleave with a running collection.
let queue: Promise<unknown> = Promise.resolve()
let queuedCount = 0
let activeAbort: AbortController | null = null
const queuedAborts = new Set<AbortController>()

function exclusive<T>(task: (signal: AbortSignal) => Promise<T>, onProgress?: (text: string) => void): Promise<T> {
  if (queuedCount > 0) onProgress?.('이전 작업이 끝날 때까지 대기 중…')
  queuedCount++
  const controller = new AbortController()
  queuedAborts.add(controller)
  const result = queue.then(async () => {
    activeAbort = controller
    const stop = keepServiceWorkerAlive()
    try {
      return await task(controller.signal)
    } finally {
      queuedAborts.delete(controller)
      if (activeAbort === controller) activeAbort = null
      queuedCount--
      stop()
    }
  })
  queue = result.catch(() => undefined)
  return result
}

const pace = createPacer(REQUEST_GAP_MS, Date.now, (ms) => abortableSleep(ms, activeAbort?.signal))

/** Defined exactly when AI is on. */
async function scoringDeps(
  criteria: SearchCriteria,
  options?: { signal?: AbortSignal; onProgress?: (text: string) => void; onBatchCommitted?: () => void },
): Promise<ScoringDeps | undefined> {
  const ai = await loadAiSettings(chrome.storage.local)
  if (!aiEnabled(ai)) return undefined
  const provider = resolvedProvider(ai)
  const instruction = buildInstruction(criteria)
  return {
    minScore: ai.minScore,
    now: new Date(),
    provider,
    pace: () => pace(provider === 'exaone' ? EXAONE_REQUEST_GAP_MS : REQUEST_GAP_MS),
    signal: options?.signal,
    onProgress: ({ scored, total }) => options?.onProgress?.(`AI 채점 중 (${scored}/${total}건)…`),
    onBatchCommitted: options?.onBatchCommitted,
    score: async (items) => {
      try {
        return await scoreWithProvider(ai, instruction, items, { fetch: (url, init) => fetch(url, init), signal: options?.signal })
      } finally {
        pace.mark()
      }
    },
    onUsage: async (usage, count) => {
      await recordAiUsage(chrome.storage.local, ai.model, count, usage, new Date())
    },
  }
}

async function loadResumableBySite(store: Store, baseKeywords: readonly string[], siteSettings: SiteSettings): Promise<Record<string, string[]>> {
  const states = await store.listCollectStates()
  const activeBySite = new Map<string, Set<string>>()
  const grouped: Record<string, string[]> = {}
  for (const state of states) {
    if (!state.resume) continue
    let active = activeBySite.get(state.site)
    if (!active) {
      active = new Set(siteKeywords(state.site, baseKeywords, siteSettings))
      activeBySite.set(state.site, active)
    }
    if (!active.has(state.keyword)) continue
    ;(grouped[state.site] ??= []).push(state.keyword)
  }
  return grouped
}

async function collectNow(options?: {
  site?: string
  keyword?: string
  continueFromCap?: boolean
  signal?: AbortSignal
  onProgress?: (text: string) => void
  onCommitted?: () => void
}): Promise<ResponseData['collect']> {
  options?.onProgress?.('수집 준비 중…')
  const [store, criteria, siteSettings] = await Promise.all([storePromise, readCriteria(), loadSiteSettings(chrome.storage.local, adapterIds)])
  const adapterById = new Map(adapters.map((a) => [a.id, a]))
  const report = await runAllSites(selectAdaptersForRun(adapters, options?.site, siteSettings), criteria, store, {
    fetchHtml: (url) => fetchHtml(url, options?.signal),
    sleep: (ms) => abortableSleep(ms, options?.signal),
    keywords: options?.keyword ? [options.keyword] : undefined,
    continueFromCap: options?.continueFromCap,
    signal: options?.signal,
    onProgress: options?.onProgress,
    onSiteCommitted: options?.onCommitted,
    now: new Date(),
    scoring: await scoringDeps(criteria, { signal: options?.signal, onProgress: options?.onProgress, onBatchCommitted: options?.onCommitted }),
    maxItemsFor: (id) => {
      const adapter = adapterById.get(id)
      return adapter ? siteMaxItems(adapter, siteSettings) : undefined
    },
    keywordsFor: (id) => siteKeywords(id, criteria.keywords, siteSettings),
  })
  await recordSiteRuns(chrome.storage.local, report.runs)
  return report
}

async function commitSettings(prev: SettingsSnapshot, next: SettingsSnapshot): Promise<SettingsResult> {
  const changed = settingsChanged(prev, next)
  await chrome.storage.local.set({ [CRITERIA_KEY]: next.criteria })
  await storeAiSettings(chrome.storage.local, next.ai)
  if (!changed) return { changed, removed: 0, queued: 0 }
  const siteSettings = await loadSiteSettings(chrome.storage.local, adapterIds)
  const { removed, queued } = await applyCriteriaChange(
    await storePromise,
    next.criteria,
    { aiOn: aiEnabled(next.ai), keywordsBySite: siteSettings.keywordsBySite },
    new Date(),
  )
  return { changed, removed, queued }
}

async function handle(request: Request, onProgress?: (text: string) => void, onCommitted?: () => void): Promise<ResponseData[Request['type']]> {
  switch (request.type) {
    case 'getCriteria':
      return readCriteria()
    case 'getAiSettings':
      return toAiView(await loadAiSettings(chrome.storage.local))
    case 'getAiUsage':
      return loadAiUsage(chrome.storage.local)
    case 'clearAiUsage':
      return exclusive(async () => {
        await clearAiUsage(chrome.storage.local)
        return emptyAiUsage()
      })
    case 'saveSettings': {
      const prev = { criteria: await readCriteria(), ai: await loadAiSettings(chrome.storage.local) }
      const next = {
        criteria: normalizeCriteria(request.criteria),
        ai: mergeAiInput(prev.ai, request.ai),
      }
      await chrome.storage.local.set({ [CRITERIA_KEY]: next.criteria })
      await storeAiSettings(chrome.storage.local, next.ai)
      activeAbort?.abort()
      return exclusive(async () => commitSettings(prev, next))
    }
    case 'deleteAiKey': {
      const prev = { criteria: await readCriteria(), ai: await loadAiSettings(chrome.storage.local) }
      const next = {
        criteria: prev.criteria,
        ai: clearProviderKey(prev.ai, request.provider),
      }
      await storeAiSettings(chrome.storage.local, next.ai)
      activeAbort?.abort()
      return exclusive(async () => commitSettings(prev, next))
    }
    case 'checkAiKey': {
      const saved = await loadAiSettings(chrome.storage.local)
      const provider = request.provider ?? resolvedProvider(saved)
      const key = request.apiKey.trim() || providerKey(saved, provider)
      const settings = normalizeAiSettings({ ...saved, provider, apiKey: key, model: request.model, keys: { ...saved.keys, [provider]: key }, models: { ...saved.models, [provider]: request.model } })
      if (!aiEnabled(settings)) return { ok: false, message: 'API 키를 먼저 입력해 주세요.' }
      const result = await checkProviderKey(settings, { fetch: (url, init) => fetch(url, init) })
      return result.kind === 'ok' ? { ok: true } : { ok: false, message: formatAiError(result.error, provider) }
    }
    case 'getSiteSettings': {
      const [settings, runs, criteria, store] = await Promise.all([
        loadSiteSettings(chrome.storage.local, adapterIds),
        loadSiteRuns(chrome.storage.local),
        readCriteria(),
        storePromise,
      ])
      return { settings, runs, resumableBySite: await loadResumableBySite(store, criteria.keywords, settings) }
    }
    case 'saveSiteSettings': {
      const known = new Set(adapterIds)
      if (!request.enabledSites.some((id) => known.has(id))) throw new Error(LAST_SITE_MESSAGE)
      const current = await loadSiteSettings(chrome.storage.local, adapterIds)
      const settings = parseSiteSettings(
        {
          enabledSites: request.enabledSites,
          siteOrder: request.siteOrder ?? current.siteOrder,
          maxItemsBySite: request.maxItemsBySite ?? current.maxItemsBySite,
          keywordsBySite: request.keywordsBySite !== undefined ? request.keywordsBySite : current.keywordsBySite,
        },
        adapterIds,
      )
      await storeSiteSettings(chrome.storage.local, settings)
      if (keywordsBySiteChanged(current, settings)) {
        activeAbort?.abort()
        await exclusive(async () => {
          const [store, criteria, ai] = await Promise.all([storePromise, readCriteria(), loadAiSettings(chrome.storage.local)])
          await applyCriteriaChange(store, criteria, { aiOn: aiEnabled(ai), keywordsBySite: settings.keywordsBySite }, new Date())
        })
      }
      return settings
    }
    case 'collect':
      return exclusive(
        (signal) =>
          collectNow({
            site: request.site,
            keyword: request.keyword,
            continueFromCap: request.continueFromCap,
            signal,
            onProgress,
            onCommitted,
          }),
        onProgress,
      )
      case 'scorePending':
      return exclusive(async (signal) => {
        onProgress?.('AI 채점 준비 중…')
        const [criteria, ai, store] = await Promise.all([readCriteria(), loadAiSettings(chrome.storage.local), storePromise])
        const deps = await scoringDeps(criteria, { signal, onProgress, onBatchCommitted: onCommitted })
        if (!deps) return { scored: 0, kept: 0, lowScore: 0, pendingLeft: (await store.listPending()).length, error: 'AI 채점이 꺼져 있습니다. 조건 설정에서 API 키를 저장해 주세요.' }
        const pass = await scorePending(store, deps)
        await addSiteRunUsage(chrome.storage.local, pass.usageBySite)
        return toScoringSummary(pass, resolvedProvider(ai))
      }, onProgress)
    case 'pendingCount':
      return (await (await storePromise).listPending()).length
    case 'listPostings':
      return (await storePromise).listPostings()
    case 'updatePosting':
      // Not queued behind a collection: the store transaction already makes each update atomic, and the UI must stay responsive.
      return (await storePromise).updatePosting(request.key, request.patch, new Date())
    case 'resetCollect':
      activeAbort?.abort()
      return exclusive(async (signal) => {
        if (signal.aborted) return collectNow({ signal, onProgress, onCommitted })
        onProgress?.('저장된 공고를 초기화하는 중…')
        await (await storePromise).clearAll()
        await clearSiteRuns(chrome.storage.local)
        return collectNow({ signal, onProgress, onCommitted })
      }, onProgress)
    case 'cancelWork': {
      const hadActive = queuedAborts.size > 0
      for (const controller of queuedAborts) controller.abort()
      return hadActive
    }
  }
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'rpc') return
  let closed = false
  let pingTimer: ReturnType<typeof setInterval> | undefined

  const stopPing = () => {
    if (pingTimer !== undefined) {
      clearInterval(pingTimer)
      pingTimer = undefined
    }
  }
  port.onDisconnect.addListener(() => {
    closed = true
    stopPing()
  })

  port.onMessage.addListener((message: Request) => {
    stopPing()
    const postSafe = (payload: unknown) => {
      if (closed) return
      try {
        port.postMessage(payload)
      } catch {
        closed = true
        stopPing()
      }
    }
    pingTimer = setInterval(() => postSafe({ kind: 'ping' }), KEEPALIVE_MS)

    handle(message, (text) => postSafe({ kind: 'progress', text }), () => postSafe({ kind: 'committed' }))
      .then((data) => postSafe({ kind: 'response', response: { ok: true, data } as ResponseFor<Request> }))
      .catch((error: unknown) =>
        postSafe({
          kind: 'response',
          response: { ok: false, error: error instanceof Error ? error.message : String(error) },
        }),
      )
      .finally(stopPing)
  })
})

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse: (r: ResponseFor<Request>) => void) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data } as ResponseFor<Request>))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  return true
})
