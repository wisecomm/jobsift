import jobkoreaJson from '../adapters/jobkorea.json'
import { parseAdapter } from '../src/adapter/schema'
import { collect } from '../src/engine/collect'

const USER_AGENT =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const LIVE_MAX_PAGES = 2

const keyword = process.argv[2]
if (!keyword) {
  console.error('사용법: npm run collect:live -- <키워드>')
  process.exit(1)
}

const adapter = parseAdapter(jobkoreaJson)
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
    now: new Date(),
    maxPages: LIVE_MAX_PAGES,
  },
)
console.error(`${result.postings.length}건, 중단 사유: ${JSON.stringify(result.stopReasons)}`)
console.log(JSON.stringify(result.postings, null, 2))
