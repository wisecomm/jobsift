import { describe, expect, it } from 'vitest'
import { parseAdapter } from '../src/adapter/schema'
import {
  DEFAULT_MAX_ITEMS,
  defaultSiteMaxItems,
  loadSiteSettings,
  moveSite,
  parseSiteSettings,
  selectAdaptersForRun,
  setSiteMaxItems,
  siteMaxItems,
  storeSiteSettings,
  toggleSite,
} from '../src/engine/siteSettings'
import { adapter as first } from './helpers'

const ALL = ['jobkorea', 'second', 'third']
const second = parseAdapter({ ...structuredClone(first), id: 'second', name: '세컨드' })
const third = parseAdapter({ ...structuredClone(first), id: 'third', name: '서드' })
const adapters = [first, second, third]

describe('parseSiteSettings', () => {
  it('defaults to every available site when nothing is stored', () => {
    expect(parseSiteSettings(undefined, ALL)).toEqual({ enabledSites: ALL, siteOrder: ALL })
    expect(parseSiteSettings({ enabledSites: 'jobkorea' }, ALL)).toEqual({ enabledSites: ALL, siteOrder: ALL })
  })

  it('keeps the stored choice, migrates missing siteOrder, and drops unknown ids', () => {
    expect(parseSiteSettings({ enabledSites: ['second', 'unknown', 'second'] }, ALL)).toEqual({
      enabledSites: ['second'],
      siteOrder: ALL,
    })
    expect(parseSiteSettings({ enabledSites: ['third', 'jobkorea'], siteOrder: ['second', 'unknown', 'third'] }, ['jobkorea', 'second', 'third'])).toEqual({
      enabledSites: ['third', 'jobkorea'],
      siteOrder: ['second', 'third', 'jobkorea'],
    })
  })

  it('falls back to every site in siteOrder when no enabled site remains', () => {
    expect(parseSiteSettings({ enabledSites: [] }, ALL)).toEqual({ enabledSites: ALL, siteOrder: ALL })
    expect(parseSiteSettings({ enabledSites: ['unknown'], siteOrder: ['third', 'second', 'jobkorea'] }, ALL)).toEqual({
      enabledSites: ['third', 'second', 'jobkorea'],
      siteOrder: ['third', 'second', 'jobkorea'],
    })
  })
})

describe('site settings storage', () => {
  it('round-trips enabledSites and siteOrder through a storage area', async () => {
    const data: Record<string, unknown> = {}
    const area = { get: async (key: string) => ({ [key]: data[key] }), set: async (items: Record<string, unknown>) => void Object.assign(data, items) }
    await storeSiteSettings(area, { enabledSites: ['third', 'second'], siteOrder: ['third', 'second', 'jobkorea'] })
    expect(await loadSiteSettings(area, ALL)).toEqual({
      enabledSites: ['third', 'second'],
      siteOrder: ['third', 'second', 'jobkorea'],
    })
  })
})

describe('toggleSite', () => {
  it('turns a site off while another stays on', () => {
    expect(toggleSite({ enabledSites: ALL, siteOrder: ALL }, 'jobkorea', false)).toEqual({
      kind: 'changed',
      settings: { enabledSites: ['second', 'third'], siteOrder: ALL },
    })
  })

  it('refuses to turn off the last enabled site', () => {
    expect(toggleSite({ enabledSites: ['second'], siteOrder: ALL }, 'second', false)).toEqual({ kind: 'last-site' })
  })

  it('turns a site back on in its siteOrder slot without duplicating it', () => {
    expect(toggleSite({ enabledSites: ['third'], siteOrder: ['third', 'jobkorea', 'second'] }, 'jobkorea', true)).toEqual({
      kind: 'changed',
      settings: { enabledSites: ['third', 'jobkorea'], siteOrder: ['third', 'jobkorea', 'second'] },
    })
    expect(toggleSite({ enabledSites: ALL, siteOrder: ALL }, 'second', true).kind).toBe('changed')
  })
})

describe('moveSite', () => {
  it('moves a site up or down and syncs enabledSites order', () => {
    const base = { enabledSites: ['jobkorea', 'third'], siteOrder: ['jobkorea', 'second', 'third'] }
    const movedUp = moveSite(base, 'third', 'up')
    expect(movedUp).toEqual({ enabledSites: ['jobkorea', 'third'], siteOrder: ['jobkorea', 'third', 'second'] })
    expect(moveSite(movedUp, 'third', 'up')).toEqual({
      enabledSites: ['third', 'jobkorea'],
      siteOrder: ['third', 'jobkorea', 'second'],
    })
    expect(moveSite(base, 'jobkorea', 'down')).toEqual({
      enabledSites: ['jobkorea', 'third'],
      siteOrder: ['second', 'jobkorea', 'third'],
    })
  })

  it('returns settings unchanged when already at the top or bottom', () => {
    const base = { enabledSites: ALL, siteOrder: ALL }
    expect(moveSite(base, 'jobkorea', 'up')).toBe(base)
    expect(moveSite(base, 'third', 'down')).toBe(base)
  })
})

describe('selectAdaptersForRun', () => {
  it('returns enabled adapters in siteOrder, or a single explicitly requested adapter', () => {
    const settings = { enabledSites: ['third', 'jobkorea'], siteOrder: ['third', 'second', 'jobkorea'] }
    expect(selectAdaptersForRun(adapters, undefined, settings).map((a) => a.id)).toEqual(['third', 'jobkorea'])
    expect(selectAdaptersForRun(adapters, 'second', settings).map((a) => a.id)).toEqual(['second'])
  })
})

describe('per-site maxItems', () => {
  it('defaults to 2000 and allows overriding per site', () => {
    const base = { enabledSites: ALL, siteOrder: ALL }
    expect(DEFAULT_MAX_ITEMS).toBe(2000)
    expect(defaultSiteMaxItems(first)).toBe(2000)
    expect(siteMaxItems(first, base)).toBe(2000)

    const updated = setSiteMaxItems(base, 'jobkorea', 250)
    expect(siteMaxItems(first, updated)).toBe(250)
    expect(siteMaxItems(second, updated)).toBe(2000)

    expect(parseSiteSettings({ enabledSites: ALL, maxItemsBySite: { jobkorea: 250.4, unknown: 100, second: 0 } }, ALL)).toEqual({
      enabledSites: ALL,
      siteOrder: ALL,
      maxItemsBySite: { jobkorea: 250 },
    })
  })
})
