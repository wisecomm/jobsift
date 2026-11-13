import jobkoreaJson from '../../adapters/jobkorea.json'
import { parseAdapter } from '../adapter/schema'
import { applyCriteriaChange } from '../engine/applyCriteriaChange'
import { criteriaChanged, normalizeCriteria, parseCriteria } from '../engine/criteria'
import { runCollection } from '../engine/runCollection'
import type { Request, ResponseData, ResponseFor } from '../shared/messages'
import type { SearchCriteria } from '../shared/types'
import { openStore } from '../storage/store'

const adapter = parseAdapter(jobkoreaJson)
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

async function collectNow(): Promise<ResponseData['collect']> {
  const [store, criteria] = await Promise.all([storePromise, readCriteria()])
  return runCollection(adapter, criteria, store, { fetchHtml, now: new Date() })
}

async function handle(request: Request): Promise<ResponseData[Request['type']]> {
  switch (request.type) {
    case 'getCriteria':
      return readCriteria()
    case 'saveCriteria':
      return exclusive(async () => {
        const next = normalizeCriteria(request.criteria)
        const changed = criteriaChanged(await readCriteria(), next)
        // Cleanup runs before persisting so an interrupted cleanup is redone by the next save, which still sees a change.
        const removed = changed ? (await applyCriteriaChange(await storePromise, adapter.id, next, { aiOn: false }, new Date())).removed : 0
        await chrome.storage.local.set({ [CRITERIA_KEY]: next })
        return { changed, removed }
      })
    case 'collect':
      return exclusive(collectNow)
    case 'listPostings':
      return (await storePromise).listPostings(adapter.id)
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
