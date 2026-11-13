import { postingSources, type JobPosting, type PostingSource } from '../shared/types'

const CORP_PREFIX_RE = /\((?:주|유|합|사|재|복)\)|주식회사|유한회사|사단법인|재단법인|협동조합/g
const NON_WORD_RE = /[^\p{L}\p{N}]/gu

export function normalizeCompany(company: string): string {
  return company.normalize('NFKC').replace(CORP_PREFIX_RE, '').replace(NON_WORD_RE, '').toLowerCase()
}

export function normalizeTitle(title: string): string {
  return title.normalize('NFKC').replace(CORP_PREFIX_RE, '').replace(NON_WORD_RE, '').toLowerCase()
}

export function normalizeLocations(locations: readonly string[]): string {
  const normalized = locations
    .map((loc) =>
      loc
        .normalize('NFKC')
        .replace(/전체\s*$/, '')
        .replace(NON_WORD_RE, '')
        .toLowerCase(),
    )
    .filter(Boolean)
  return [...new Set(normalized)].sort().join('|')
}

export function dedupKey(posting: Pick<JobPosting, 'company' | 'title' | 'locations'>): string {
  return `${normalizeCompany(posting.company)}\0${normalizeTitle(posting.title)}\0${normalizeLocations(posting.locations)}`
}

export function addSource<
  T extends Pick<JobPosting, 'site' | 'externalId' | 'url'> & { alsoOn?: PostingSource[]; matchedKeywords: string[] },
>(existing: T, incoming: JobPosting, matchedKeywords: readonly string[]): T | null {
  if (postingSources(existing).some((s) => s.site === incoming.site && s.externalId === incoming.externalId)) {
    return null
  }
  const mergedKeywords = [...new Set([...existing.matchedKeywords, ...matchedKeywords])]
  const alsoOn = [...(existing.alsoOn ?? []), { site: incoming.site, externalId: incoming.externalId, url: incoming.url }]
  return { ...existing, alsoOn, matchedKeywords: mergedKeywords }
}
