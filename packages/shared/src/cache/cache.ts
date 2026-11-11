import { type DBSchema, type IDBPDatabase, openDB } from 'idb'
import type { SyncItem } from '../api'
import type { KdfParams } from '../kdf'

/** What a device remembers about the account. Nothing here is plaintext vault data. */
export type CacheMeta = {
  readonly account_id: string
  readonly email: string
  readonly kdf: KdfParams
  readonly kdf_salt: string
  /** The last KDF settings this device unlocked with. Absent until the first unlock. */
  readonly pinned_kdf?: KdfParams
  readonly wrapped_vault_key: string
  readonly last_revision: number
  /** The device bearer token. It can call the API but cannot decrypt anything. */
  readonly token: string
  readonly device_id: string
  /** Highest `seq` seen per item id, for rollback detection. */
  readonly seen_seq: Readonly<Record<string, number>>
  /** Ids of items for which the server sent an older version than this device had seen. */
  readonly flagged_rollbacks?: readonly string[]
  /** True once this device knows the forced TOTP enrollment is done. */
  readonly totp_enrolled?: boolean
}

/** A write waiting to reach the server. Replayed in order. */
export type PendingOp = {
  readonly seq?: number
  readonly op: 'put' | 'delete'
  readonly id: string
  readonly base_revision: number
  readonly ciphertext: string
  readonly trashed: boolean
  readonly queued_at: number
}

interface CacheSchema extends DBSchema {
  meta: { key: string; value: CacheMeta }
  items: { key: string; value: SyncItem }
  pending_ops: { key: number; value: PendingOp }
}

const DB_NAME = 'securepass'
const DB_VERSION = 1
const META_KEY = 'main'

/** An open handle on the encrypted local cache (IndexedDB). */
export type Cache = IDBPDatabase<CacheSchema>

/**
 * Opens the local cache, creating its three stores on first use.
 * @param name - Database name. Tests pass their own.
 */
export const openCache = (name: string = DB_NAME): Promise<Cache> =>
  openDB<CacheSchema>(name, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore('meta')
      db.createObjectStore('items', { keyPath: 'id' })
      db.createObjectStore('pending_ops', { keyPath: 'seq', autoIncrement: true })
    },
  })

/** Reads the account record, or `undefined` on a device that has never been set up or signed in. */
export const readMeta = (cache: Cache): Promise<CacheMeta | undefined> =>
  cache.get('meta', META_KEY)

/** Replaces the account record. */
export const writeMeta = async (cache: Cache, meta: CacheMeta): Promise<void> => {
  await cache.put('meta', meta, META_KEY)
}

/** Every cached server row, as received. */
export const readItems = (cache: Cache): Promise<SyncItem[]> => cache.getAll('items')

/**
 * Applies a sync page: purged rows are removed, the rest are stored, and `last_revision` moves forward.
 * One transaction, so a crash cannot leave rows newer than the revision.
 * @param replaceAll - True on a full resync: every cached item is dropped first.
 */
export const applySyncPage = async (
  cache: Cache,
  rows: readonly SyncItem[],
  revision: number,
  replaceAll = false,
): Promise<void> => {
  const tx = cache.transaction(['items', 'meta'], 'readwrite')
  if (replaceAll) await tx.objectStore('items').clear()
  for (const row of rows) {
    if (row.purged) await tx.objectStore('items').delete(row.id)
    else await tx.objectStore('items').put(row)
  }
  const meta = await tx.objectStore('meta').get(META_KEY)
  if (meta) await tx.objectStore('meta').put({ ...meta, last_revision: revision }, META_KEY)
  await tx.done
}

/** Queues a write at the end of the pending list. */
export const queueOp = async (cache: Cache, op: PendingOp): Promise<void> => {
  await cache.add('pending_ops', op)
}

/**
 * Queues a write, replacing any write already queued for the same item. Only the newest version
 * of an item needs to reach the server, and it keeps the base revision of the oldest queued write,
 * which is the last revision the server is known to hold.
 */
export const queueLatestOp = async (cache: Cache, op: PendingOp): Promise<void> => {
  const tx = cache.transaction('pending_ops', 'readwrite')
  const queued = (await tx.store.getAll()).filter((entry) => entry.id === op.id)
  for (const entry of queued) if (entry.seq !== undefined) await tx.store.delete(entry.seq)
  const { seq: _seq, ...rest } = op
  await tx.store.add({ ...rest, base_revision: queued[0]?.base_revision ?? op.base_revision })
  await tx.done
}

/** Replaces a queued write in place, keeping its position in the queue. */
export const rewritePending = async (cache: Cache, op: PendingOp): Promise<void> => {
  if (op.seq !== undefined) await cache.put('pending_ops', op)
}

/** One cached server row, or `undefined`. */
export const readItem = (cache: Cache, id: string): Promise<SyncItem | undefined> =>
  cache.get('items', id)

/** Pending writes in the order they were queued. */
export const readPending = (cache: Cache): Promise<PendingOp[]> => cache.getAll('pending_ops')

/** Drops a pending write once the server has accepted it. */
export const removePending = async (cache: Cache, seq: number): Promise<void> => {
  await cache.delete('pending_ops', seq)
}

/** Empties every store. Used when the device is signed out for good. */
export const clearCache = async (cache: Cache): Promise<void> => {
  const tx = cache.transaction(['meta', 'items', 'pending_ops'], 'readwrite')
  await Promise.all([
    tx.objectStore('meta').clear(),
    tx.objectStore('items').clear(),
    tx.objectStore('pending_ops').clear(),
  ])
  await tx.done
}
