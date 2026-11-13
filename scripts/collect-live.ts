import { getAdapter } from '../src/adapter/registry'
import { collect } from '../src/engine/collect'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const LIVE_MAX_PAGES = 2

const keyword = process.argv[2]
const site = process.argv[3] ?? 'jobkorea'
if (!keyword) {
  console.error('사용법: npm run collect:live -- <키워드> [사이트]')
  process.exit(1)
}

const adapter = getAdapter(site)
if (!adapter) {
  console.error(`알 수 없는 사이트입니다: ${site}`)
  process.exit(1)
}
const result = await collect(
  adapter,
  { keywords: [keyword], excludeKeywords: [], locations: [], career: 'any', initialDays: 7, description: '' },
  {
    fetchHtml: async (url) => {
      console.error(`GET ${url}`)
      const response = await fetch(url, { headers: { 'User-Agent': USER_AGENT, 'Accept-Language': 'ko-KR,ko;q=0.9' } })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.text()
    },
    knownIds: new Set(),
    cutoffFor: () => new Date(Date.now() - 7 * 86_400_000),
    maxPages: LIVE_MAX_PAGES,
  },
)
console.error(`${result.postings.length}건, 중단 사유: ${JSON.stringify(result.stopReasons)}`)
if (Object.keys(result.errors).length > 0) console.error(`오류: ${JSON.stringify(result.errors)}`)
console.log(JSON.stringify(result.postings, null, 2))
