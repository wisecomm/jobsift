import { describe, expect, it } from 'vitest'
import {
  clearProviderKey,
  loadAiSettings,
  mergeAiInput,
  normalizeAiSettings,
  settingsChanged,
  storeAiSettings,
  toAiView,
  type StorageArea,
} from '../src/ai/settings'
import type { AiSettings } from '../src/shared/types'
import { criteria } from './helpers'

const KEY = 'fake-key-for-local-test'
const EXAONE_KEY = 'fake-exaone-key-for-local-test'

function memoryArea(): StorageArea & { data: Record<string, unknown> } {
  const data: Record<string, unknown> = {}
  return {
    data,
    get: async (key) => (key in data ? { [key]: data[key] } : {}),
    set: async (items) => void Object.assign(data, items),
  }
}

const ai = (over: Partial<AiSettings> = {}) => normalizeAiSettings({ apiKey: KEY, model: 'm', minScore: 60, ...over })

describe('AI settings storage', () => {
  it('falls back to defaults: gemini provider, no keys, default models, minScore 60', async () => {
    expect(await loadAiSettings(memoryArea())).toEqual({
      provider: 'gemini',
      apiKey: '',
      model: 'gemini-3.5-flash-lite',
      keys: { gemini: '', exaone: '' },
      models: { gemini: 'gemini-3.5-flash-lite', exaone: 'k-exaone_v2.5' },
      minScore: 60,
    })
  })

  it('round-trips and normalizes', async () => {
    const area = memoryArea()
    await storeAiSettings(area, normalizeAiSettings({ apiKey: ` ${KEY} `, model: '  ', minScore: 140.4 }))
    expect(await loadAiSettings(area)).toEqual({
      provider: 'gemini',
      apiKey: KEY,
      model: 'gemini-3.5-flash-lite',
      keys: { gemini: KEY, exaone: '' },
      models: { gemini: 'gemini-3.5-flash-lite', exaone: 'k-exaone_v2.5' },
      minScore: 100,
    })
  })

  it('treats unreadable storage as defaults', async () => {
    const area = memoryArea()
    area.data['aiSettings'] = { apiKey: 5 }
    expect((await loadAiSettings(area)).apiKey).toBe('')
  })
})

describe('the page view', () => {
  it('never carries any key', () => {
    const view = toAiView(ai({ keys: { gemini: KEY, exaone: EXAONE_KEY } }))
    expect(view).toEqual({
      provider: 'gemini',
      hasKey: true,
      model: 'm',
      hasKeyByProvider: { gemini: true, exaone: true },
      modelsByProvider: { gemini: 'm', exaone: 'k-exaone_v2.5' },
      minScore: 60,
    })
    expect(JSON.stringify(view)).not.toContain(KEY)
    expect(JSON.stringify(view)).not.toContain(EXAONE_KEY)
    expect(toAiView(ai({ apiKey: '' })).hasKey).toBe(false)
  })
})

describe('the view built from stored settings', () => {
  it('carries no key, even when the stored key is long and distinctive', async () => {
    const area = memoryArea()
    await storeAiSettings(area, mergeAiInput(await loadAiSettings(area), { apiKey: KEY, model: '', minScore: 55 }))
    const view = toAiView(await loadAiSettings(area))
    expect(view).toEqual({
      provider: 'gemini',
      hasKey: true,
      model: 'gemini-3.5-flash-lite',
      hasKeyByProvider: { gemini: true, exaone: false },
      modelsByProvider: { gemini: 'gemini-3.5-flash-lite', exaone: 'k-exaone_v2.5' },
      minScore: 55,
    })
    expect(JSON.stringify(view)).not.toContain(KEY)
  })
})

describe('mergeAiInput and clearProviderKey', () => {
  it('keeps the saved key when the key field is empty, and replaces it otherwise', () => {
    expect(mergeAiInput(ai(), { apiKey: '', model: 'n', minScore: 70 })).toEqual(ai({ model: 'n', minScore: 70 }))
    expect(mergeAiInput(ai(), { apiKey: ' new-key ', model: 'm', minScore: 60 }).apiKey).toBe('new-key')
  })

  it('stores and clears Gemini and EXAONE keys independently when switching the active default provider', () => {
    const withGemini = mergeAiInput(ai({ apiKey: '' }), { provider: 'gemini', apiKey: KEY, model: '', minScore: 60 })
    const withExaoneDefault = mergeAiInput(withGemini, { provider: 'exaone', apiKey: EXAONE_KEY, model: '', minScore: 65 })
    expect(withExaoneDefault).toMatchObject({
      provider: 'exaone',
      apiKey: EXAONE_KEY,
      model: 'k-exaone_v2.5',
      keys: { gemini: KEY, exaone: EXAONE_KEY },
      models: { gemini: 'gemini-3.5-flash-lite', exaone: 'k-exaone_v2.5' },
      minScore: 65,
    })

    const backToGemini = mergeAiInput(withExaoneDefault, { provider: 'gemini', apiKey: '', model: '', minScore: 65 })
    expect(backToGemini.provider).toBe('gemini')
    expect(backToGemini.apiKey).toBe(KEY)
    expect(backToGemini.keys?.exaone).toBe(EXAONE_KEY)

    const clearedExaone = clearProviderKey(backToGemini, 'exaone')
    expect(clearedExaone.keys).toEqual({ gemini: KEY, exaone: '' })
    expect(clearedExaone.apiKey).toBe(KEY)
  })
})

describe('settingsChanged', () => {
  const base = { criteria: criteria({ description: '전산' }), ai: ai() }

  it('is false when nothing relevant differs', () => {
    expect(settingsChanged(base, { criteria: criteria({ description: ' 전산 ' }), ai: ai({ apiKey: 'other-key' }) })).toBe(false)
  })

  it('notices turning AI on or off', () => {
    expect(settingsChanged(base, { ...base, ai: ai({ apiKey: '' }) })).toBe(true)
    expect(settingsChanged({ ...base, ai: ai({ apiKey: '' }) }, base)).toBe(true)
  })

  it('notices description, minScore and model changes while AI is on', () => {
    expect(settingsChanged(base, { ...base, criteria: criteria({ description: '회계' }) })).toBe(true)
    expect(settingsChanged(base, { ...base, ai: ai({ minScore: 70 }) })).toBe(true)
    expect(settingsChanged(base, { ...base, ai: ai({ model: 'other' }) })).toBe(true)
  })

  it('ignores those three while AI is off, since they change nothing', () => {
    const off = { criteria: criteria({ description: '전산' }), ai: ai({ apiKey: '' }) }
    expect(settingsChanged(off, { criteria: criteria({ description: '회계' }), ai: ai({ apiKey: '', minScore: 10, model: 'z' }) })).toBe(false)
  })

  it('still notices a rule change', () => {
    expect(settingsChanged(base, { ...base, criteria: criteria({ description: '전산', locations: ['서울'] }) })).toBe(true)
  })
})
