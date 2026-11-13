import { describe, expect, it } from 'vitest'
import { loadSiteSettings, parseSiteSettings, storeSiteSettings, toggleSite } from '../src/engine/siteSettings'

const ALL = ['jobkorea', 'second']

describe('parseSiteSettings', () => {
  it('defaults to every available site when nothing is stored', () => {
    expect(parseSiteSettings(undefined, ALL)).toEqual({ enabledSites: ALL })
    expect(parseSiteSettings({ enabledSites: 'jobkorea' }, ALL)).toEqual({ enabledSites: ALL })
  })

  it('keeps the stored choice and drops ids no adapter owns', () => {
    expect(parseSiteSettings({ enabledSites: ['second', 'saramin', 'second'] }, ALL)).toEqual({ enabledSites: ['second'] })
  })

  it('falls back to the default when nothing known is left', () => {
    expect(parseSiteSettings({ enabledSites: [] }, ALL)).toEqual({ enabledSites: ALL })
    expect(parseSiteSettings({ enabledSites: ['saramin'] }, ALL)).toEqual({ enabledSites: ALL })
  })
})

describe('site settings storage', () => {
  it('round-trips through a storage area', async () => {
    const data: Record<string, unknown> = {}
    const area = { get: async (key: string) => ({ [key]: data[key] }), set: async (items: Record<string, unknown>) => void Object.assign(data, items) }
    await storeSiteSettings(area, { enabledSites: ['second'] })
    expect(await loadSiteSettings(area, ALL)).toEqual({ enabledSites: ['second'] })
  })
})

describe('toggleSite', () => {
  it('turns a site off while another stays on', () => {
    expect(toggleSite({ enabledSites: ALL }, 'jobkorea', false)).toEqual({ kind: 'changed', settings: { enabledSites: ['second'] } })
  })

  it('refuses to turn off the last enabled site', () => {
    expect(toggleSite({ enabledSites: ['second'] }, 'second', false)).toEqual({ kind: 'last-site' })
  })

  it('turns a site on without duplicating it', () => {
    expect(toggleSite({ enabledSites: ['second'] }, 'jobkorea', true)).toEqual({ kind: 'changed', settings: { enabledSites: ['second', 'jobkorea'] } })
    expect(toggleSite({ enabledSites: ALL }, 'second', true).kind).toBe('changed')
  })
})
