import { clearCache } from '@securepass/shared/cache'
import { syncVault } from '@securepass/vault'
import { env } from '../env'
import { clearLastUsed } from '../local-store'
import { clearSession, writeSession } from '../session-store'
import { dropIndex, getCache, readUnlocked } from './state'

/** Shown in the popup after the server revoked this device. */
export const REVOKED_NOTICE = 'This device was signed out.'

// One round at a time. A call during a round is folded into one more round right after.
let running: Promise<void> | undefined
let again = false

/** Wipes everything this device holds about the account. The device id is kept. */
export const wipeDevice = async (notice: string): Promise<void> => {
  await clearCache(await getCache())
  await clearSession()
  await clearLastUsed()
  await writeSession({ notice })
  dropIndex()
}

const round = async (): Promise<void> => {
  const unlocked = await readUnlocked()
  if (!unlocked) return
  await writeSession({ sync_state: { state: 'syncing' } })
  const result = await syncVault(unlocked.cache, unlocked.vaultKey, env.serverUrl)
  // Writes that landed before a round stopped still changed the cache.
  dropIndex()
  if (result.ok) {
    await writeSession({ sync_state: { state: 'synced', at: Date.now() } })
  } else if (result.error.kind === 'network') {
    await writeSession({ sync_state: { state: 'offline' } })
  } else if (result.error.kind === 'unauthorized') {
    // Revoked: lock and wipe. Merely expired: keep the cache and the queue, ask to sign in again.
    if (result.error.code === 'revoked') await wipeDevice(REVOKED_NOTICE)
    else await writeSession({ sync_state: { state: 'expired' } })
  } else {
    await writeSession({ sync_state: { state: 'attention' } })
  }
}

/**
 * Runs a sync round if the vault is unlocked: on unlock, after every write, every 5 minutes, and
 * when the browser comes back online. Rounds never overlap.
 */
export const syncNow = (): Promise<void> => {
  if (running) {
    again = true
    return running
  }
  running = (async () => {
    try {
      do {
        again = false
        await round()
      } while (again)
    } finally {
      running = undefined
    }
  })()
  return running
}
