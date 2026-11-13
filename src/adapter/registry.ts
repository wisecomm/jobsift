import jobkoreaJson from '../../adapters/jobkorea.json'
import { parseAdapter, type SiteAdapter } from './schema'

/** Parses every bundled adapter once. A new adapter is added to this list and nowhere else. */
export function buildRegistry(bundled: readonly unknown[]): ReadonlyMap<string, SiteAdapter> {
  const registry = new Map<string, SiteAdapter>()
  for (const json of bundled) {
    const adapter = parseAdapter(json)
    if (registry.has(adapter.id)) throw new Error(`어댑터 id가 겹칩니다: ${adapter.id}`)
    registry.set(adapter.id, adapter)
  }
  return registry
}

const registry = buildRegistry([jobkoreaJson])

export const adapters: readonly SiteAdapter[] = [...registry.values()]
export const adapterIds: readonly string[] = adapters.map((adapter) => adapter.id)
export const getAdapter = (id: string): SiteAdapter | undefined => registry.get(id)
