import jobkoreaJson from '../../adapters/jobkorea.json'
import { parseAdapter } from '../adapter/schema'
import { collect } from '../engine/collect'
import type { CollectRequest, CollectResponse } from '../shared/messages'

const adapter = parseAdapter(jobkoreaJson)

chrome.action.onClicked.addListener(() => {
  void chrome.tabs.create({ url: chrome.runtime.getURL('src/page/index.html') })
})

async function fetchHtml(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'omit' })
  if (!response.ok) throw new Error(`요청 실패 (${response.status}): ${url}`)
  return response.text()
}

chrome.runtime.onMessage.addListener((message: CollectRequest, _sender, sendResponse: (r: CollectResponse) => void) => {
  if (message?.type !== 'collect') return false
  collect(adapter, message.criteria, { fetchHtml, knownIds: new Set(), now: new Date() })
    .then(({ postings }) => sendResponse({ ok: true, postings }))
    .catch((error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }))
  return true
})
