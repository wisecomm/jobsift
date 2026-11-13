import { useState } from 'react'
import type { CareerFilter, SearchCriteria } from '../shared/types'
import { SAMPLE_DESCRIPTIONS } from './sampleDescriptions'

interface Props {
  criteria: SearchCriteria
  /** Resolves with the user-facing result message. */
  onSave: (criteria: SearchCriteria) => Promise<string>
  onDevReset: () => Promise<void>
}

const toList = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean)
const fromList = (items: string[]) => items.join(', ')

export function SettingsView({ criteria, onSave, onDevReset }: Props) {
  const [keywords, setKeywords] = useState(fromList(criteria.keywords))
  const [excludeKeywords, setExcludeKeywords] = useState(fromList(criteria.excludeKeywords))
  const [locations, setLocations] = useState(fromList(criteria.locations))
  const [career, setCareer] = useState<CareerFilter>(criteria.career)
  const [days, setDays] = useState(String(criteria.initialDays))
  const [description, setDescription] = useState(criteria.description)
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  async function run(task: () => Promise<string | void>) {
    setPending(true)
    setMessage(null)
    try {
      const text = await task()
      if (text) setMessage({ text, error: false })
    } catch (e) {
      setMessage({ text: `오류: ${e instanceof Error ? e.message : String(e)}`, error: true })
    } finally {
      setPending(false)
    }
  }

  const save = () =>
    run(() => onSave({ keywords: toList(keywords), excludeKeywords: toList(excludeKeywords), locations: toList(locations), career, initialDays: Number(days), description }))

  function useSample(text: string) {
    if (description.trim() !== '' && description !== text && !window.confirm('지금 적은 내용이 예시로 바뀝니다. 계속할까요?')) return
    setDescription(text)
  }

  return (
    <form
      className="settings"
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
    >
      <label>
        선호 키워드
        <input value={keywords} onChange={(e) => setKeywords(e.target.value)} placeholder="전산, 회계" />
        <small>쉼표로 구분합니다. 제목이나 분야에 이 중 하나라도 들어간 공고를 모읍니다.</small>
      </label>
      <label>
        제외 키워드
        <input value={excludeKeywords} onChange={(e) => setExcludeKeywords(e.target.value)} placeholder="영업, 생산직" />
        <small>쉼표로 구분합니다. 제목이나 분야에 들어 있으면 모으지 않습니다.</small>
      </label>
      <label>
        선호 지역
        <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="서울, 경기" />
        <small>쉼표로 구분합니다. 비워 두면 지역은 무관으로 봅니다.</small>
      </label>
      <div className="row">
        <label>
          경력
          <select value={career} onChange={(e) => setCareer(e.target.value as CareerFilter)}>
            <option value="any">무관</option>
            <option value="new">신입</option>
            <option value="experienced">경력</option>
          </select>
        </label>
        <label>
          최초 수집 기간 (일)
          <input type="number" min={1} value={days} onChange={(e) => setDays(e.target.value)} />
          <small>처음 수집할 때 최근 며칠 치 공고까지 가져올지 정합니다.</small>
        </label>
      </div>

      <div className="description">
        <label>
          내가 원하는 일
          <textarea rows={7} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="어떤 일을 하고 싶은지, 어떤 일은 피하고 싶은지 편하게 적어 주세요." />
          <small>이 글은 나중에 추가될 AI 점수 기능에서 공고가 나와 맞는지 판단하는 데 쓰입니다.</small>
        </label>
        <div className="samples" role="group" aria-label="예시">
          <span>예시로 채우기</span>
          {SAMPLE_DESCRIPTIONS.map((s) => (
            <button key={s.label} type="button" onClick={() => useSample(s.text)}>
              {s.label}
            </button>
          ))}
        </div>
      </div>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={pending}>저장</button>
        {import.meta.env.DEV && (
          <button type="button" disabled={pending} onClick={() => window.confirm('저장된 공고를 모두 지우고 다시 수집합니다. 계속할까요?') && void run(onDevReset)}>
            전체 초기화 (개발용)
          </button>
        )}
      </div>
      {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'warn' : 'ok'}>{message.text}</p>}
    </form>
  )
}
