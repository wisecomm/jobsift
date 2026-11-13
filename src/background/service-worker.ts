import { adapterIds, adapters } from '../adapter/registry'
import { REQUEST_GAP_MS } from '../ai/constants'
import { aiErrorMessage, checkKey, scoreBatch } from '../ai/gemini'
import { createPacer } from '../ai/pacer'
import { buildInstruction } from '../ai/prompt'
import { aiEnabled, loadAiSettings, mergeAiInput, normalizeAiSettings, settingsChanged, storeAiSettings, toAiView, type SettingsSnapshot } from '../ai/settings'
import { applyCriteriaChange } from '../engine/applyCriteriaChange'
import { normalizeCriteria, parseCriteria } from '../engine/criteria'
import { runAllSites } from '../engine/runAllSites'
import { scorePending, toScoringSummary, type ScoringDeps } from '../engine/scorePending'
import { loadSiteRuns, recordSiteRuns } from '../engine/siteRuns'
import { loadSiteSettings, LAST_SITE_MESSAGE, parseSiteSettings, selectAdaptersForRun, storeSiteSettings } from '../engine/siteSettings'
import type { Request, ResponseData, ResponseFor, SettingsResult } from '../shared/messages'
import type { SearchCriteria } from '../shared/types'
import { openStore } from '../storage/store'

const CRITERIA_KEY = 'criteria'
const storePromise = openStore()

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/page/index.html') })
})

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'omit' })
  if (!response.ok) throw new Error(`요청 실패 (${response.status}): ${url}`)
  return response.text()
}

async function readCriteria(): Promise<SearchCriteria> {
  const stored = await chrome.storage.local.get(CRITERIA_KEY)
  return parseCriteria(stored[CRITERIA_KEY])
}

// One writer at a time: a criteria save must not interleave with a running collection.
let queue: Promise<unknown> = Promise.resolve()
function exclusive<T>(task: () => Promise<T>): Promise<T> {
  const result = queue.then(task)
  queue = result.catch(() => undefined)
  return result
}

const pace = createPacer(REQUEST_GAP_MS, Date.now, (ms) => new Promise((resolve) => setTimeout(resolve, ms)))

/** Defined exactly when AI is on. */
async function scoringDeps(criteria: SearchCriteria): Promise<ScoringDeps | undefined> {
  const ai = await loadAiSettings(chrome.storage.local)
  if (!aiEnabled(ai)) return undefined
  const instruction = buildInstruction(criteria)
  return {
    minScore: ai.minScore,
    now: new Date(),
    pace,
    score: (items) => scoreBatch(ai, instruction, items, { fetch: (url, init) => fetch(url, init) }),
  }
}

async function collectNow(site?: string): Promise<ResponseData['collect']> {
  const [store, criteria, siteSettings] = await Promise.all([storePromise, readCriteria(), loadSiteSettings(chrome.storage.local, adapterIds)])
  const report = await runAllSites(selectAdaptersForRun(adapters, site, siteSettings), criteria, store, {
    fetchHtml,
    now: new Date(),
    scoring: await scoringDeps(criteria),
  })
  await recordSiteRuns(chrome.storage.local, report.runs)
  return report
}

async function commitSettings(next: SettingsSnapshot): Promise<SettingsResult> {
  const prev = { criteria: await readCriteria(), ai: await loadAiSettings(chrome.storage.local) }
  const changed = settingsChanged(prev, next)
  // Cleanup runs before persisting so an interrupted cleanup is redone by the next save, which still sees a change.
  const { removed, queued } = changed
    ? await applyCriteriaChange(await storePromise, next.criteria, { aiOn: aiEnabled(next.ai) }, new Date())
    : { removed: 0, queued: 0 }
  await chrome.storage.local.set({ [CRITERIA_KEY]: next.criteria })
  await storeAiSettings(chrome.storage.local, next.ai)
  return { changed, removed, queued }
}

async function handle(request: Request): Promise<ResponseData[Request['type']]> {
  switch (request.type) {
    case 'getCriteria':
      return readCriteria()
    case 'getAiSettings':
      return toAiView(await loadAiSettings(chrome.storage.local))
    case 'saveSettings':
      return exclusive(async () =>
        commitSettings({
          criteria: normalizeCriteria(request.criteria),
          ai: mergeAiInput(await loadAiSettings(chrome.storage.local), request.ai),
        }),
      )
    case 'deleteAiKey':
      return exclusive(async () =>
        commitSettings({ criteria: await readCriteria(), ai: { ...(await loadAiSettings(chrome.storage.local)), apiKey: '' } }),
      )
    case 'checkAiKey': {
      const saved = await loadAiSettings(chrome.storage.local)
      const settings = normalizeAiSettings({ ...saved, apiKey: request.apiKey.trim() || saved.apiKey, model: request.model })
      if (!aiEnabled(settings)) return { ok: false, message: 'API 키를 먼저 입력해 주세요.' }
      const result = await checkKey(settings, { fetch: (url, init) => fetch(url, init) })
      return result.kind === 'ok' ? { ok: true } : { ok: false, message: aiErrorMessage(result.error) }
    }
    case 'getSiteSettings':
      return { settings: await loadSiteSettings(chrome.storage.local, adapterIds), runs: await loadSiteRuns(chrome.storage.local) }
    case 'saveSiteSettings': {
      const known = new Set(adapterIds)
      if (!request.enabledSites.some((id) => known.has(id))) throw new Error(LAST_SITE_MESSAGE)
      const current = await loadSiteSettings(chrome.storage.local, adapterIds)
      const settings = parseSiteSettings(
        { enabledSites: request.enabledSites, siteOrder: request.siteOrder ?? current.siteOrder },
        adapterIds,
      )
      await storeSiteSettings(chrome.storage.local, settings)
      return settings
    }
    case 'collect':
      return exclusive(() => collectNow(request.site))
    case 'scorePending':
      return exclusive(async () => {
        const deps = await scoringDeps(await readCriteria())
        const store = await storePromise
        if (!deps) return { scored: 0, kept: 0, lowScore: 0, pendingLeft: (await store.listPending()).length, error: 'AI 채점이 꺼져 있습니다. 조건 설정에서 API 키를 저장해 주세요.' }
        return toScoringSummary(await scorePending(store, deps))
      })
    case 'pendingCount':
      return (await (await storePromise).listPending()).length
    case 'listPostings':
      return (await storePromise).listPostings()
    case 'updatePosting':
      // Not queued behind a collection: the store transaction already makes each update atomic, and the UI must stay responsive.
      return (await storePromise).updatePosting(request.key, request.patch, new Date())
    case 'devReset':
      if (!import.meta.env.DEV) throw new Error('개발 빌드에서만 사용할 수 있습니다')
      return exclusive(async () => {
        await (await storePromise).clearAll()
        return collectNow()
      })
  }
}

chrome.runtime.onMessage.addListener((message: Request, _sender, sendResponse: (r: ResponseFor<Request>) => void) => {
  handle(message)
    .then((data) => sendResponse({ ok: true, data } as ResponseFor<Request>))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  return true
})
