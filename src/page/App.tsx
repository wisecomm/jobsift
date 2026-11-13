import { useEffect, useState } from 'react'
import type { Request, ResponseFor } from '../shared/messages'
import type { Career, CareerFilter, CollectionSummary, SearchCriteria, StoredPosting } from '../shared/types'

async function send<R extends Request>(request: R): Promise<Extract<ResponseFor<R>, { ok: true }>['data']> {
  const response: ResponseFor<R> = await chrome.runtime.sendMessage(request)
  if (!response.ok) throw new Error(response.error)
  return response.data
}

const STATUS_LABEL: Record<StoredPosting['status'], string> = {
  new: '신규',
  saved: '저장',
  applied: '지원',
  dismissed: '관심없음',
  expired: '마감',
}

function careerLabel(career: Career): string {
  const years = 'minYears' in career && career.minYears !== null ? ` ${career.minYears}년↑` : ''
  switch (career.kind) {
    case 'new':
      return '신입'
    case 'any':
      return '경력무관'
    case 'experienced':
      return `경력${years}`
    case 'newOrExperienced':
      return `신입·경력${years}`
    case 'unknown':
      return '-'
  }
}

function summaryLine(s: CollectionSummary): string {
  const g = s.discardedByGate
  return `스캔 ${s.scanned} · 저장 ${s.saved} · 제외 ${s.discarded} (키워드 ${g.keywordMismatch}, 지역 ${g.location}, 경력 ${g.career}, 제외어 ${g.excludeKeyword}, 마감 ${g.expired}) · 마감 처리 ${s.expiredMarked}`
}

function displayOrder(postings: StoredPosting[]): StoredPosting[] {
  const rank = (p: StoredPosting) => (p.status === 'new' ? 0 : 1)
  return [...postings].sort((a, b) => rank(a) - rank(b) || Date.parse(b.postedAt) - Date.parse(a.postedAt))
}

const toList = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean)

export function App() {
  const [keywords, setKeywords] = useState('')
  const [excludeKeywords, setExcludeKeywords] = useState('')
  const [locations, setLocations] = useState('')
  const [career, setCareer] = useState<CareerFilter>('any')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [summary, setSummary] = useState<CollectionSummary | null>(null)
  const [postings, setPostings] = useState<StoredPosting[]>([])

  const criteria = (): SearchCriteria => ({
    keywords: toList(keywords),
    excludeKeywords: toList(excludeKeywords),
    locations: toList(locations),
    career,
    initialDays: days,
    description: '',
  })

  async function guarded(task: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await task()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  useEffect(() => {
    void guarded(async () => {
      const saved = await send({ type: 'getCriteria' })
      setKeywords(saved.keywords.join(', '))
      setExcludeKeywords(saved.excludeKeywords.join(', '))
      setLocations(saved.locations.join(', '))
      setCareer(saved.career)
      setDays(saved.initialDays)
      setPostings(await send({ type: 'listPostings' }))
    })
  }, [])

  async function save(): Promise<void> {
    const { changed, removed } = await send({ type: 'saveCriteria', criteria: criteria() })
    setNotice(changed ? `조건을 저장했습니다 (대기 공고 ${removed}건 제외)` : '조건을 저장했습니다')
    setPostings(await send({ type: 'listPostings' }))
  }

  const saveOnly = () => guarded(save)

  const collectNow = () =>
    guarded(async () => {
      await save()
      setNotice(null)
      setSummary(await send({ type: 'collect' }))
      setPostings(await send({ type: 'listPostings' }))
    })

  const devReset = () =>
    guarded(async () => {
      await save()
      setSummary(await send({ type: 'devReset' }))
      setPostings(await send({ type: 'listPostings' }))
    })

  const failed = summary ? Object.entries(summary.errors) : []

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>채용공고 모음</h1>
      <p>
        <label>
          키워드{' '}
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="전산, 회계" />
        </label>{' '}
        <label>
          제외어{' '}
          <input value={excludeKeywords} onChange={(e) => setExcludeKeywords(e.target.value)} placeholder="영업, 생산직" />
        </label>{' '}
        <label>
          지역{' '}
          <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="서울, 경기" />
        </label>
      </p>
      <p>
        <label>
          경력{' '}
          <select value={career} onChange={(e) => setCareer(e.target.value as CareerFilter)}>
            <option value="any">전체</option>
            <option value="new">신입</option>
            <option value="experienced">경력</option>
          </select>
        </label>{' '}
        <label>
          최초 수집 범위 최근{' '}
          <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 60 }} />
          일
        </label>{' '}
        <button onClick={saveOnly} disabled={busy}>
          조건 저장
        </button>{' '}
        <button onClick={collectNow} disabled={busy || toList(keywords).length === 0}>
          {busy ? '처리 중...' : '지금 수집'}
        </button>
        {import.meta.env.DEV && (
          <>
            {' '}
            <button onClick={devReset} disabled={busy}>
              전체 초기화 (개발용)
            </button>
          </>
        )}
      </p>
      {error && <p role="alert">오류: {error}</p>}
      {notice && <p>{notice}</p>}
      {summary && <p data-testid="summary">{summaryLine(summary)}</p>}
      {failed.map(([keyword, message]) => (
        <p key={keyword} role="alert">
          키워드 "{keyword}" 수집 실패: {message}
        </p>
      ))}
      <p>저장된 공고 {postings.length}건</p>
      <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse' }}>
        <thead>
          <tr>
            <th>상태</th>
            <th>제목</th>
            <th>회사</th>
            <th>지역</th>
            <th>경력</th>
            <th>일치 키워드</th>
            <th>등록일</th>
            <th>마감일</th>
          </tr>
        </thead>
        <tbody>
          {displayOrder(postings).map((p) => (
            <tr key={`${p.site}:${p.externalId}`}>
              <td>{STATUS_LABEL[p.status]}</td>
              <td>
                <a href={p.url} target="_blank" rel="noreferrer">
                  {p.title}
                </a>
              </td>
              <td>{p.company}</td>
              <td>{p.locations.join(', ')}</td>
              <td>{careerLabel(p.career)}</td>
              <td>{p.matchedKeywords.join(', ')}</td>
              <td>{p.postedAt.slice(0, 16).replace('T', ' ')}</td>
              <td>{p.deadline ? p.deadline.slice(0, 10) : '상시'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  )
}
