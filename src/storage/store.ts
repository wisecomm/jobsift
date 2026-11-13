import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { postingSources, type CollectState, type DiscardRecord, type PendingPosting, type PostingKey, type PostingPatch, type StoredPosting, type UpdateResult } from '../shared/types'

export interface Store {
  /** Every site's postings when `site` is omitted. */
  listPostings(site?: string): Promise<StoredPosting[]>
  getPosting(key: PostingKey): Promise<StoredPosting | undefined>
  putPosting(posting: StoredPosting): Promise<void>
  /** Stores the posting only if its key is free, so a re-collect never resets status or memo. Returns whether it was stored. */
  addPosting(posting: StoredPosting): Promise<boolean>
  deletePosting(key: PostingKey): Promise<void>
  /** Read-modify-write in one transaction. An expired posting refuses a status change, so the rule holds for every caller. */
  updatePosting(key: PostingKey, patch: PostingPatch, now: Date): Promise<UpdateResult>
  /** Marks open postings past their deadline as expired in one transaction, so a status or memo edit made meanwhile is not overwritten. Returns how many changed. */
  markExpired(site: string, now: Date): Promise<number>

  listDiscards(site: string): Promise<DiscardRecord[]>
  putDiscard(record: DiscardRecord): Promise<void>
  deleteDiscards(keys: PostingKey[]): Promise<void>

  /** Every site's pending postings when `site` is omitted. */
  listPending(site?: string): Promise<PendingPosting[]>
  putPending(posting: PendingPosting): Promise<void>
  deletePending(keys: PostingKey[]): Promise<void>
  /** Resolves scored pending postings in one transaction, so an interruption never leaves one both queued and stored, or neither. */
  commitScored(outcome: { kept: StoredPosting[]; dropped: DiscardRecord[]; resolved: PostingKey[] }): Promise<void>

  /** Ids of every posting, discard and pending posting for the site. */
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
  pending: { key: [string, string]; value: PendingPosting }
  collectState: { key: [string, string]; value: CollectState }
}

const DB_NAME = 'kr-job-finder'
const DB_VERSION = 2

const siteRange = (site: string) => IDBKeyRange.bound([site], [site, []])
const keyOf = ({ site, externalId }: PostingKey): [string, string] => [site, externalId]

export async function openStore(name = DB_NAME): Promise<Store> {
  const db: IDBPDatabase<Schema> = await openDB<Schema>(name, DB_VERSION, {
    upgrade(database, oldVersion) {
      if (oldVersion < 1) {
        database.createObjectStore('postings', { keyPath: ['site', 'externalId'] })
        database.createObjectStore('discards', { keyPath: ['site', 'externalId'] })
        database.createObjectStore('collectState', { keyPath: ['site', 'keyword'] })
      }
      if (oldVersion < 2) database.createObjectStore('pending', { keyPath: ['site', 'externalId'] })
    },
  })

  return {
    listPostings: (site) => db.getAll('postings', site === undefined ? undefined : siteRange(site)),
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
    async updatePosting(key, patch, now) {
      const tx = db.transaction('postings', 'readwrite')
      const current = await tx.store.get(keyOf(key))
      if (!current) return { kind: 'not-found' }
      if (patch.status !== undefined && current.status === 'expired') return { kind: 'expired' }
      const posting: StoredPosting = {
        ...current,
        status: patch.status ?? current.status,
        memo: patch.memo ?? current.memo,
        updatedAt: now.toISOString(),
      }
      await tx.store.put(posting)
      await tx.done
      return { kind: 'updated', posting }
    },
    async markExpired(site, now) {
      const tx = db.transaction('postings', 'readwrite')
      let marked = 0
      for (const posting of await tx.store.getAll()) {
        if (!postingSources(posting).some((s) => s.site === site)) continue
        const open = posting.status === 'new' || posting.status === 'saved'
        if (!open || posting.deadline === null || Date.parse(posting.deadline) >= now.getTime()) continue
        await tx.store.put({ ...posting, status: 'expired', updatedAt: now.toISOString() })
        marked++
      }
      await tx.done
      return marked
    },

    listDiscards: (site) => db.getAll('discards', siteRange(site)),
    // Copy the known fields so a caller passing a whole posting cannot leak its title or url into the record.
    putDiscard: async ({ site, externalId, reason, discardedAt, deadline }) =>
      void (await db.put('discards', { site, externalId, reason, discardedAt, deadline })),
    async deleteDiscards(keys) {
      const tx = db.transaction('discards', 'readwrite')
      await Promise.all([...keys.map((key) => tx.store.delete(keyOf(key))), tx.done])
    },

    listPending: (site) => db.getAll('pending', site === undefined ? undefined : siteRange(site)),
    putPending: async (posting) => void (await db.put('pending', posting)),
    async deletePending(keys) {
      const tx = db.transaction('pending', 'readwrite')
      await Promise.all([...keys.map((key) => tx.store.delete(keyOf(key))), tx.done])
    },
    async commitScored({ kept, dropped, resolved }) {
      const tx = db.transaction(['postings', 'discards', 'pending'], 'readwrite')
      await Promise.all([
        ...kept.map((posting) => tx.objectStore('postings').put(posting)),
        ...dropped.map(({ site, externalId, reason, discardedAt, deadline }) =>
          tx.objectStore('discards').put({ site, externalId, reason, discardedAt, deadline }),
        ),
        ...resolved.map((key) => tx.objectStore('pending').delete(keyOf(key))),
        tx.done,
      ])
    },

    async knownIds(site) {
      const [postings, discards, pending] = await Promise.all([
        db.getAll('postings'),
        db.getAllKeys('discards', siteRange(site)),
        db.getAll('pending'),
      ])
      const ids = new Set<string>(discards.map(([, externalId]) => externalId))
      for (const record of [...postings, ...pending]) {
        for (const source of postingSources(record)) {
          if (source.site === site) ids.add(source.externalId)
        }
      }
      return ids
    },

    getCollectState: (site, keyword) => db.get('collectState', [site, keyword]),
    putCollectState: async (state) => void (await db.put('collectState', state)),

    clearDiscards: () => db.clear('discards'),
    clearCollectState: () => db.clear('collectState'),
    async clearAll() {
      const tx = db.transaction(['postings', 'discards', 'collectState', 'pending'], 'readwrite')
      await Promise.all([
        tx.objectStore('postings').clear(),
        tx.objectStore('discards').clear(),
        tx.objectStore('collectState').clear(),
        tx.objectStore('pending').clear(),
        tx.done,
      ])
    },
  }
}
