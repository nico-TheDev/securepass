import type { Cache } from '@securepass/shared/cache'
import type { SyncError } from '@securepass/shared/sync'
import { syncVault } from '@securepass/vault'
import { useCallback, useEffect, useRef, useState } from 'react'
import { env } from '../env'

/** How the last sync went, for the status line. */
export type SyncStatus =
  | { readonly state: 'idle' }
  | { readonly state: 'syncing' }
  | { readonly state: 'synced'; readonly at: number }
  | { readonly state: 'offline' }
  | { readonly state: 'attention'; readonly reason: SyncError }

const FIVE_MINUTES = 5 * 60 * 1000

type Options = {
  readonly cache: Cache
  readonly vaultKey: Uint8Array
  /** Called after every round, so the list can reload from the cache. */
  readonly onSynced: () => void
  /** Called when the server says this device was revoked. */
  readonly onRevoked: () => void
}

/**
 * Runs the sync loop while the vault is unlocked: once at the start, every 5 minutes,
 * whenever the browser comes back online, and whenever `syncNow` is called (after a local write).
 * Rounds never overlap: a call during a round is folded into one more round right after.
 */
export const useSync = ({ cache, vaultKey, onSynced, onRevoked }: Options) => {
  const [status, setStatus] = useState<SyncStatus>({ state: 'idle' })
  const running = useRef(false)
  const again = useRef(false)
  const callbacks = useRef({ onSynced, onRevoked })
  callbacks.current = { onSynced, onRevoked }

  const syncNow = useCallback(async (): Promise<void> => {
    if (running.current) {
      again.current = true
      return
    }
    running.current = true
    try {
      do {
        again.current = false
        setStatus({ state: 'syncing' })
        const result = await syncVault(cache, vaultKey, env.VITE_API_URL)
        if (result.ok) {
          setStatus({ state: 'synced', at: Date.now() })
          callbacks.current.onSynced()
        } else if (result.error.kind === 'network') {
          setStatus({ state: 'offline' })
        } else if (result.error.kind === 'unauthorized' && result.error.code === 'revoked') {
          callbacks.current.onRevoked()
          return
        } else {
          setStatus({ state: 'attention', reason: result.error })
          // Writes that landed before the round stopped still changed the cache.
          callbacks.current.onSynced()
        }
      } while (again.current)
    } finally {
      running.current = false
    }
  }, [cache, vaultKey])

  useEffect(() => {
    void syncNow()
    const timer = setInterval(() => void syncNow(), FIVE_MINUTES)
    const onOnline = () => void syncNow()
    window.addEventListener('online', onOnline)
    return () => {
      clearInterval(timer)
      window.removeEventListener('online', onOnline)
    }
  }, [syncNow])

  return { status, syncNow }
}
