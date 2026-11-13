import { useState } from 'react'
import type { CollectRequest, CollectResponse } from '../shared/messages'
import type { Career, CareerFilter, JobPosting } from '../shared/types'

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

export function App() {
  const [keywords, setKeywords] = useState('')
  const [career, setCareer] = useState<CareerFilter>('any')
  const [days, setDays] = useState(7)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postings, setPostings] = useState<JobPosting[] | null>(null)

  async function run() {
    setBusy(true)
    setError(null)
    const request: CollectRequest = {
      type: 'collect',
      criteria: {
        keywords: keywords.split(',').map((k) => k.trim()).filter(Boolean),
        excludeKeywords: [],
        locations: [],
        career,
        initialDays: days,
        description: '',
      },
    }
    try {
      const response: CollectResponse = await chrome.runtime.sendMessage(request)
      if (response.ok) setPostings(response.postings)
      else setError(response.error)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <h1>채용공고 모음</h1>
      <p>
        <label>
          키워드(쉼표로 구분){' '}
          <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="전산, 회계" />
        </label>{' '}
        <label>
          경력{' '}
          <select value={career} onChange={(e) => setCareer(e.target.value as CareerFilter)}>
            <option value="any">전체</option>
            <option value="new">신입</option>
            <option value="experienced">경력</option>
          </select>
        </label>{' '}
        <label>
          최근{' '}
          <input type="number" min={1} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 60 }} />
          일
        </label>{' '}
        <button onClick={run} disabled={busy || keywords.trim() === ''}>
          {busy ? '수집 중...' : '지금 수집'}
        </button>
      </p>
      {error && <p role="alert">오류: {error}</p>}
      {postings && (
        <>
          <p>총 {postings.length}건</p>
          <table border={1} cellPadding={4} style={{ borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th>제목</th>
                <th>회사</th>
                <th>지역</th>
                <th>경력</th>
                <th>등록일</th>
                <th>마감일</th>
              </tr>
            </thead>
            <tbody>
              {postings.map((p) => (
                <tr key={p.externalId}>
                  <td>
                    <a href={p.url} target="_blank" rel="noreferrer">
                      {p.title}
                    </a>
                  </td>
                  <td>{p.company}</td>
                  <td>{p.locations.join(', ')}</td>
                  <td>{careerLabel(p.career)}</td>
                  <td>{p.postedAt.slice(0, 16).replace('T', ' ')}</td>
                  <td>{p.deadline ? p.deadline.slice(0, 10) : '상시'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </main>
  )
}
