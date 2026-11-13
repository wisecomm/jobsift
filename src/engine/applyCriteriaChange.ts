import type { Store } from '../storage/store'
import type { SearchCriteria } from '../shared/types'
import { evaluate } from './evaluate'

/** Postings the user has acted on are never touched; only untouched `new` ones follow the criteria. */
export async function applyCriteriaChange(
  store: Store,
  site: string,
  criteria: SearchCriteria,
  now: Date,
): Promise<{ removed: number }> {
  await Promise.all([store.clearDiscards(), store.clearCollectState()])

  let removed = 0
  for (const posting of await store.listPostings(site)) {
    if (posting.status !== 'new') continue
    const result = evaluate(posting, criteria, now)
    if (result.kind === 'pass') {
      await store.putPosting({ ...posting, matchedKeywords: result.matchedKeywords, updatedAt: now.toISOString() })
      continue
    }
    await store.putDiscard({
      site: posting.site,
      externalId: posting.externalId,
      reason: result.reason,
      discardedAt: now.toISOString(),
      deadline: posting.deadline,
    })
    await store.deletePosting(posting)
    removed++
  }
  return { removed }
}
