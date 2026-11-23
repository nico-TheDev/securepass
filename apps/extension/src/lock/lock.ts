import { clearUnlock, readSession } from '../session-store'
import { dropIndex } from '../vault/state'
import { shouldLock } from './rules'

/** Locks the vault: the unlocked key and the decrypted index are removed from memory. */
export const lockNow = async (): Promise<void> => {
  await clearUnlock()
  dropIndex()
}

/** Locks when the last extension activity is 15 minutes old. Run by a 1 minute alarm. */
export const lockIfIdle = async (now: number): Promise<void> => {
  const { vault_key, last_activity_at } = await readSession('vault_key', 'last_activity_at')
  if (vault_key && shouldLock(last_activity_at, now)) await lockNow()
}
