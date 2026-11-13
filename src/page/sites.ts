import jobkorea from '../../adapters/jobkorea.json'

const SITE_NAMES: Record<string, string> = { [jobkorea.id]: jobkorea.name }

export const siteName = (id: string): string => SITE_NAMES[id] ?? id
