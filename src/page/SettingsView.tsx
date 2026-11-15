import { useEffect, useState } from 'react'
import type { AiInput } from '../ai/settings'
import type { AiProvider, AiSettingsView, AiUsageRecord, CareerFilter, SearchCriteria } from '../shared/types'
import { AI_PROVIDER_LABELS, DEFAULT_MODELS } from '../ai/constants'
import { formatDateTime } from './format'
import { SAMPLE_DESCRIPTIONS } from './sampleDescriptions'

interface Props {
  criteria: SearchCriteria
  ai: AiSettingsView
  aiUsage: AiUsageRecord | null
  /** Each handler resolves with the user-facing result message, or throws a Korean error message. */
  onSave: (criteria: SearchCriteria, ai: AiInput) => Promise<string>
  onCheckKey: (provider: AiProvider, apiKey: string, model: string) => Promise<string>
  onDeleteKey: (provider: AiProvider) => Promise<string>
  onClearAiUsage: () => Promise<string>
}

const toList = (text: string) => text.split(',').map((item) => item.trim()).filter(Boolean)
const fromList = (items: string[]) => items.join(', ')
const fmt = (n: number) => n.toLocaleString('ko-KR')

export function SettingsView({ criteria, ai, aiUsage, onSave, onCheckKey, onDeleteKey, onClearAiUsage }: Props) {
  const [keywords, setKeywords] = useState(fromList(criteria.keywords))
  const [locations, setLocations] = useState(fromList(criteria.locations))
  const [career, setCareer] = useState<CareerFilter>(criteria.career)
  const [description, setDescription] = useState(criteria.description)
  const [provider, setProvider] = useState<AiProvider>(ai.provider)
  const [draftKeys, setDraftKeys] = useState<Record<AiProvider, string>>({ gemini: '', exaone: '' })
  const [draftModels, setDraftModels] = useState<Record<AiProvider, string>>(() => ({
    gemini: ai.modelsByProvider.gemini || DEFAULT_MODELS.gemini,
    exaone: ai.modelsByProvider.exaone || DEFAULT_MODELS.exaone,
  }))
  const [minScore, setMinScore] = useState(String(ai.minScore))
  const [pending, setPending] = useState(false)
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null)

  useEffect(() => {
    setKeywords(fromList(criteria.keywords))
    setLocations(fromList(criteria.locations))
    setCareer(criteria.career)
    setDescription(criteria.description)
  }, [criteria])

  useEffect(() => {
    setProvider(ai.provider)
    setDraftModels({
      gemini: ai.modelsByProvider.gemini || DEFAULT_MODELS.gemini,
      exaone: ai.modelsByProvider.exaone || DEFAULT_MODELS.exaone,
    })
    setMinScore(String(ai.minScore))
  }, [ai])

  const currentKey = draftKeys[provider]
  const currentModel = draftModels[provider]
  const providerHasKey = ai.hasKeyByProvider[provider]
  const hostName = provider === 'exaone' ? 'LG AI연구원(EXAONE)' : 'Google'

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
        { keywords: toList(keywords), locations: toList(locations), career, description },
        { provider, apiKey: currentKey, model: currentModel, minScore: Number(minScore) },
      )
      setDraftKeys((prev) => ({ ...prev, [provider]: '' }))
      return text
    })

  const deleteKey = () => {
    const label = provider === 'exaone' ? 'EXAONE' : 'Gemini'
    const isDefault = provider === ai.provider
    const confirmText = isDefault
      ? `저장된 ${label} API 키를 지웁니다. AI 채점이 꺼지고 키워드 규칙만 쓰게 됩니다. 계속할까요?`
      : `저장된 ${label} API 키를 지웁니다. 계속할까요?`
    return window.confirm(confirmText)
      ? run(async () => {
          const text = await onDeleteKey(provider)
          setDraftKeys((prev) => ({ ...prev, [provider]: '' }))
          return text
        })
      : undefined
  }

  const clearUsage = () =>
    window.confirm('저장된 AI 토큰 사용량 누적을 0으로 초기화할까요?') ? run(onClearAiUsage) : undefined

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
        선호 지역
        <input value={locations} onChange={(e) => setLocations(e.target.value)} placeholder="서울, 경기" />
        <small>쉼표로 구분합니다. 비워 두면 지역은 무관으로 봅니다.</small>
      </label>
      <label>
        경력
        <select value={career} onChange={(e) => setCareer(e.target.value as CareerFilter)}>
          <option value="any">무관</option>
          <option value="new">신입</option>
          <option value="experienced">경력</option>
        </select>
      </label>

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
          {ai.hasKey ? (
            <span className="ok">기본 사용: {AI_PROVIDER_LABELS[ai.provider]} · AI 채점 켜짐</span>
          ) : (
            <span className="hint">{AI_PROVIDER_LABELS[ai.provider]} 키가 없으면 키워드 규칙만 사용합니다.</span>
          )}
          <small>
            {' '}
            (저장된 키 · Gemini: {ai.hasKeyByProvider.gemini ? '있음' : '없음'} / EXAONE: {ai.hasKeyByProvider.exaone ? '있음' : '없음'})
          </small>
        </p>
        <label>
          AI 제공자 (기본 사용)
          <select value={provider} onChange={(e) => setProvider(e.target.value as AiProvider)}>
            <option value="gemini">{AI_PROVIDER_LABELS.gemini}</option>
            <option value="exaone">{AI_PROVIDER_LABELS.exaone}</option>
          </select>
          <small>선택 후 저장하면 이 제공자가 기본으로 사용되며, 두 제공자의 키는 각각 따로 저장됩니다.</small>
        </label>
        <label>
          {provider === 'exaone' ? 'EXAONE API 키' : 'Gemini API 키'}
          <input
            type="password"
            autoComplete="off"
            value={currentKey}
            onChange={(e) => setDraftKeys((prev) => ({ ...prev, [provider]: e.target.value }))}
            placeholder={
              providerHasKey
                ? '키 저장됨 (바꾸려면 새 키를 입력)'
                : provider === 'exaone'
                  ? 'EXAONE API Platform (docs.exaone.ai)에서 받은 키'
                  : 'Google AI Studio에서 받은 키'
            }
          />
        </label>
        <div className="row">
          <label>
            모델
            <input
              value={currentModel}
              onChange={(e) => setDraftModels((prev) => ({ ...prev, [provider]: e.target.value }))}
              placeholder={DEFAULT_MODELS[provider]}
            />
          </label>
          <label>
            기준 점수 (0~100)
            <input type="number" min={0} max={100} value={minScore} onChange={(e) => setMinScore(e.target.value)} />
            <small>이 점수 이상인 공고만 목록에 남깁니다.</small>
          </label>
        </div>
        <div className="form-actions">
          <button
            type="button"
            disabled={pending || (!providerHasKey && currentKey.trim() === '')}
            onClick={() => void run(() => onCheckKey(provider, currentKey, currentModel))}
          >
            키 확인
          </button>
          <button type="button" disabled={pending || !providerHasKey} onClick={() => void deleteKey()}>
            키 삭제
          </button>
        </div>
        {aiUsage && (
          <div className="ai-usage">
            <div className="ai-usage-head">
              <strong>누적 토큰 사용량</strong>
              {aiUsage.requests > 0 && (
                <button type="button" disabled={pending} onClick={() => void clearUsage()}>
                  사용량 초기화
                </button>
              )}
            </div>
            {aiUsage.requests === 0 ? (
              <p className="hint">아직 기록된 AI 채점 토큰 사용량이 없습니다.</p>
            ) : (
              <>
                <p>
                  요청 {fmt(aiUsage.requests)}회 · 채점 {fmt(aiUsage.scoredPostings)}건 · 총 {fmt(aiUsage.totals.totalTokens)}토큰 (입력{' '}
                  {fmt(aiUsage.totals.inputTokens)} · 출력 {fmt(aiUsage.totals.outputTokens)}
                  {aiUsage.totals.thoughtTokens > 0 ? ` · 사고 ${fmt(aiUsage.totals.thoughtTokens)}` : ''}
                  {aiUsage.totals.cachedTokens > 0 ? ` · 캐시 ${fmt(aiUsage.totals.cachedTokens)}` : ''})
                </p>
                {Object.keys(aiUsage.byModel).length > 0 && (
                  <ul className="ai-notes">
                    {Object.entries(aiUsage.byModel).map(([name, m]) => (
                      <li key={name}>
                        {name}: {fmt(m.requests)}회 · {fmt(m.totalTokens)}토큰 (입력 {fmt(m.inputTokens)} / 출력 {fmt(m.outputTokens)}
                        {m.thoughtTokens > 0 ? ` / 사고 ${fmt(m.thoughtTokens)}` : ''})
                      </li>
                    ))}
                  </ul>
                )}
                {aiUsage.updatedAt && <small>마지막 기록: {formatDateTime(aiUsage.updatedAt)}</small>}
              </>
            )}
          </div>
        )}
        <ul className="ai-notes">
          <li>키는 이 브라우저 프로필에 암호화 없이 저장되며, {hostName} 외에는 어디로도 보내지 않습니다.</li>
          <li>채점할 때 공고의 제목, 회사, 직무 태그, 경력, 지역과 위의 "내가 원하는 일" 글이 {hostName}(으)로 전송됩니다.</li>
          <li>사용량 제한이나 요금은 내 키를 기준으로 {hostName}이(가) 정합니다.</li>
        </ul>
      </fieldset>

      <div className="form-actions">
        <button type="submit" className="primary" disabled={pending}>저장</button>
      </div>
      {message && <p role={message.error ? 'alert' : 'status'} className={message.error ? 'warn' : 'ok'}>{message.text}</p>}
    </form>
  )
}
