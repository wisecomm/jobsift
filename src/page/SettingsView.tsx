import { useState } from 'react'
import type { AiInput } from '../ai/settings'
import type { AiSettingsView, CareerFilter, SearchCriteria } from '../shared/types'
import { DEFAULT_MODEL } from '../ai/constants'
import { SAMPLE_DESCRIPTIONS } from './sampleDescriptions'

interface Props {
  criteria: SearchCriteria
  ai: AiSettingsView
  /** Each handler resolves with the user-facing result message, or throws a Korean error message. */
  onSave: (criteria: SearchCriteria, ai: AiInput) => Promise<string>
  onCheckKey: (apiKey: string, model: string) => Promise<string>
  onDeleteKey: () => Promise<string>
  onDevReset: () => Promise<void>
}

const toList = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean)
const fromList = (items: string[]) => items.join(', ')

export function SettingsView({ criteria, ai, onSave, onCheckKey, onDeleteKey, onDevReset }: Props) {
  const [keywords, setKeywords] = useState(fromList(criteria.keywords))
  const [excludeKeywords, setExcludeKeywords] = useState(fromList(criteria.excludeKeywords))
  const [locations, setLocations] = useState(fromList(criteria.locations))
  const [career, setCareer] = useState<CareerFilter>(criteria.career)
  const [days, setDays] = useState(String(criteria.initialDays))
  const [description, setDescription] = useState(criteria.description)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState(ai.model)
  const [minScore, setMinScore] = useState(String(ai.minScore))
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
    run(async () => {
      const text = await onSave(
        { keywords: toList(keywords), excludeKeywords: toList(excludeKeywords), locations: toList(locations), career, initialDays: Number(days), description },
        { apiKey, model, minScore: Number(minScore) },
      )
      setApiKey('')
      return text
    })

  const deleteKey = () =>
    window.confirm('저장된 API 키를 지웁니다. AI 채점이 꺼지고 키워드 규칙만 쓰게 됩니다. 계속할까요?') ? run(onDeleteKey) : undefined

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
          <small>AI 채점을 켜면 이 글을 기준으로 공고가 나와 맞는지 점수를 매깁니다. API 키가 없으면 쓰이지 않습니다.</small>
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

      <fieldset className="ai">
        <legend>AI 채점</legend>
        <p className="ai-state">
          {ai.hasKey ? <span className="ok">키 저장됨 · AI 채점 켜짐</span> : <span className="hint">키가 없으면 키워드 규칙만 사용합니다.</span>}
        </p>
        <label>
          Gemini API 키
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={ai.hasKey ? '키 저장됨 (바꾸려면 새 키를 입력)' : 'Google AI Studio에서 받은 키'}
          />
        </label>
        <div className="row">
          <label>
            모델
            <input value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULT_MODEL} />
          </label>
          <label>
            기준 점수 (0~100)
            <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
            <small>이 점수 이상인 공고만 목록에 남깁니다.</small>
          </label>
        </div>
        <div className="form-actions">
          <button type="button" disabled={pending || (!ai.hasKey && apiKey.trim() === '')} onClick={() => void run(() => onCheckKey(apiKey, model))}>
            키 확인
          </button>
          <button type="button" disabled={pending || !ai.hasKey} onClick={() => void deleteKey()}>
            키 삭제
          </button>
        </div>
        <ul className="ai-notes">
          <li>키는 이 브라우저 프로필에 암호화 없이 저장되며, Google 외에는 어디로도 보내지 않습니다.</li>
          <li>채점할 때 공고의 제목, 회사, 직무 태그, 경력, 지역과 위의 "내가 원하는 일" 글이 Google로 전송됩니다.</li>
          <li>사용량 제한이나 요금은 내 키를 기준으로 Google이 정합니다.</li>
        </ul>
      </fieldset>

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
