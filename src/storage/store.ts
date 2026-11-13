import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { CollectState, DiscardRecord, PostingKey, StoredPosting } from '../shared/types'

export interface Store {
  listPostings(site: string): Promise<StoredPosting[]>
  getPosting(key: PostingKey): Promise<StoredPosting | undefined>
  putPosting(posting: StoredPosting): Promise<void>
  /** Stores the posting only if its key is free, so a re-collect never resets status or memo. Returns whether it was stored. */
  addPosting(posting: StoredPosting): Promise<boolean>
  deletePosting(key: PostingKey): Promise<void>

  listDiscards(site: string): Promise<DiscardRecord[]>
  putDiscard(record: DiscardRecord): Promise<void>
  deleteDiscards(keys: PostingKey[]): Promise<void>

  /** Ids of every posting and discard for the site. */
  knownIds(site: string): Promise<Set<string>>

  getCollectState(site: string, keyword: string): Promise<CollectState | undefined>
  putCollectState(state: CollectState): Promise<void>

  clearDiscards(): Promise<void>
  clearCollectState(): Promise<void>
  clearAll(): Promise<void>
}

interface Schema extends DBSchema {
  postings: { key: [string, string]; value: StoredPosting }
  discards: { key: [string, string]; value: DiscardRecord }
  collectState: { key: [string, string]; value: CollectState }
}

const DB_NAME = 'kr-job-finder'

const siteRange = (site: string) => IDBKeyRange.bound([site], [site, []])
const keyOf = ({ site, externalId }: PostingKey): [string, string] => [site, externalId]

export async function openStore(name = DB_NAME): Promise<Store> {
  const db: IDBPDatabase<Schema> = await openDB<Schema>(name, 1, {
    upgrade(database) {
      database.createObjectStore('postings', { keyPath: ['site', 'externalId'] })
      database.createObjectStore('discards', { keyPath: ['site', 'externalId'] })
      database.createObjectStore('collectState', { keyPath: ['site', 'keyword'] })
    },
  })

  return {
    listPostings: (site) => db.getAll('postings', siteRange(site)),
    getPosting: (key) => db.get('postings', keyOf(key)),
    putPosting: async (posting) => void (await db.put('postings', posting)),
    async addPosting(posting) {
      const tx = db.transaction('postings', 'readwrite')
      const exists = (await tx.store.getKey(keyOf(posting))) !== undefined
      if (!exists) await tx.store.put(posting)
      await tx.done
      return !exists
    },
    deletePosting: (key) => db.delete('postings', keyOf(key)),

    listDiscards: (site) => db.getAll('discards', siteRange(site)),
    // Copy the known fields so a caller passing a whole posting cannot leak its title or url into the record.
    putDiscard: async ({ site, externalId, reason, discardedAt, deadline }) =>
      void (await db.put('discards', { site, externalId, reason, discardedAt, deadline })),
    async deleteDiscards(keys) {
      const tx = db.transaction('discards', 'readwrite')
      await Promise.all([...keys.map((key) => tx.store.delete(keyOf(key))), tx.done])
    },

    async knownIds(site) {
      const [postings, discards] = await Promise.all([
        db.getAllKeys('postings', siteRange(site)),
        db.getAllKeys('discards', siteRange(site)),
      ])
      return new Set([...postings, ...discards].map(([, externalId]) => externalId))
    },

    getCollectState: (site, keyword) => db.get('collectState', [site, keyword]),
    putCollectState: async (state) => void (await db.put('collectState', state)),

    clearDiscards: () => db.clear('discards'),
    clearCollectState: () => db.clear('collectState'),
    async clearAll() {
      const tx = db.transaction(['postings', 'discards', 'collectState'], 'readwrite')
      await Promise.all([tx.objectStore('postings').clear(), tx.objectStore('discards').clear(), tx.objectStore('collectState').clear(), tx.done])
    },
  }
}
