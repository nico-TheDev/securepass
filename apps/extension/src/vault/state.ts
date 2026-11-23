import { type Cache, openCache } from '@securepass/shared/cache'
import { loadVaultItems, type OpenVaultItem } from '@securepass/vault'
import { readSession, readVaultKey } from '../session-store'

// The service worker's only module state: the open cache handle and the decrypted index. Both are
// memory only and are rebuilt lazily when the worker wakes, as spec 0004 calls for.
let cachePromise: Promise<Cache> | undefined
let index: { readonly key: string; readonly items: readonly OpenVaultItem[] } | undefined

/** The encrypted local cache (IndexedDB), opened once per worker life. */
export const getCache = (): Promise<Cache> => {
  cachePromise ??= openCache()
  return cachePromise
}

/** Forgets the decrypted index, after a lock, a sync, or a local write. */
export const dropIndex = (): void => {
  index = undefined
}

/** The cache and vault key while unlocked, or `null` while locked (fill rule 3). */
export const readUnlocked = async (): Promise<{
  readonly cache: Cache
  readonly vaultKey: Uint8Array
} | null> => {
  const vaultKey = await readVaultKey()
  return vaultKey ? { cache: await getCache(), vaultKey } : null
}

/**
 * Every item that opens, decrypted in memory, or `null` while locked. Built from the encrypted
 * cache on first use and after anything changed.
 */
export const loadIndex = async (): Promise<readonly OpenVaultItem[] | null> => {
  const { vault_key } = await readSession('vault_key')
  if (!vault_key) {
    index = undefined
    return null
  }
  if (index?.key === vault_key) return index.items
  const unlocked = await readUnlocked()
  if (!unlocked) return null
  const items = (await loadVaultItems(unlocked.cache, unlocked.vaultKey)).filter(
    (item): item is OpenVaultItem => item.kind === 'item',
  )
  index = { key: vault_key, items }
  return items
}
