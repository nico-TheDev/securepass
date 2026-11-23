import { fromBase64Url } from '@securepass/crypto'
import { type Cache, type CacheMeta, openCache, readMeta } from '@securepass/shared/cache'
import { useCallback, useEffect, useRef, useState } from 'react'
import { hasPin } from '../lock/pin'
import {
  onSessionChange,
  readSession,
  removeSession,
  storeUnlock,
  type UnlockMethod,
} from '../session-store'
import { send } from './background'
import { SignIn } from './sign-in'
import { Unlock } from './unlock'
import { Vault } from './vault'

type Screen =
  | { readonly name: 'loading' }
  | { readonly name: 'sign-in'; readonly notice?: string | undefined }
  | { readonly name: 'unlock'; readonly meta: CacheMeta; readonly pin: boolean }
  | {
      readonly name: 'vault'
      readonly meta: CacheMeta
      readonly keyText: string
      readonly vaultKey: Uint8Array
      readonly method: UnlockMethod
    }

/** A short text that changes only when the screen should really be rebuilt. */
const signature = (screen: Screen): string =>
  screen.name === 'vault'
    ? `vault|${screen.keyText}|${screen.method}|${screen.meta.token}`
    : screen.name === 'unlock'
      ? `unlock|${screen.pin}|${screen.meta.account_id}`
      : `${screen.name}|${screen.name === 'sign-in' ? (screen.notice ?? '') : ''}`

/**
 * Picks the popup screen from what the extension holds: sign in on a new install, unlock when a
 * local copy exists, the vault while the key is in session memory. It follows session storage, so
 * a lock by the background shows at once.
 */
export function App() {
  const [cache, setCache] = useState<Cache | undefined>()
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })
  const shown = useRef('loading|')

  const refresh = useCallback(async (opened: Cache) => {
    const [meta, session, pin] = await Promise.all([
      readMeta(opened),
      readSession('vault_key', 'unlocked_with', 'notice'),
      hasPin(),
    ])
    const vaultKey = session.vault_key ? fromBase64Url(session.vault_key) : null
    const next: Screen = !meta
      ? { name: 'sign-in', notice: session.notice }
      : vaultKey && session.vault_key
        ? {
            name: 'vault',
            meta,
            keyText: session.vault_key,
            vaultKey,
            method: session.unlocked_with ?? 'password',
          }
        : { name: 'unlock', meta, pin }
    if (signature(next) === shown.current) return
    shown.current = signature(next)
    setScreen(next)
  }, [])

  useEffect(() => {
    let stop = (): void => {}
    let cancelled = false
    void (async () => {
      const opened = await openCache()
      if (cancelled) return
      setCache(opened)
      // Opening the popup counts as activity.
      await send({ type: 'activity' })
      await refresh(opened)
      stop = onSessionChange(() => void refresh(opened))
    })()
    return () => {
      cancelled = true
      stop()
    }
  }, [refresh])

  const unlocked = async (vaultKey: Uint8Array, method: UnlockMethod) => {
    await removeSession('notice')
    await storeUnlock(vaultKey, method, Date.now())
    // The background syncs and brings any waiting save prompt up to date.
    void send({ type: 'unlocked' })
  }

  if (!cache || screen.name === 'loading') {
    return (
      <main className="screen" role="status">
        Loading…
      </main>
    )
  }
  switch (screen.name) {
    case 'sign-in':
      return (
        <SignIn
          cache={cache}
          notice={screen.notice}
          onSignedIn={(session) => void unlocked(session.vaultKey, 'password')}
        />
      )
    case 'unlock':
      return (
        <Unlock
          cache={cache}
          meta={screen.meta}
          pinAvailable={screen.pin}
          onUnlocked={(vaultKey, method) => void unlocked(vaultKey, method)}
          onPinRemoved={() => void refresh(cache)}
        />
      )
    case 'vault':
      return (
        <Vault cache={cache} meta={screen.meta} vaultKey={screen.vaultKey} method={screen.method} />
      )
  }
}
