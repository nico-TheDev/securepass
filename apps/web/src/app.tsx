import {
  type Cache,
  type CacheMeta,
  clearCache,
  openCache,
  readMeta,
} from '@securepass/shared/cache'
import { useCallback, useEffect, useState } from 'react'
import { SetupScreen } from './auth/setup-screen'
import { SignInScreen } from './auth/sign-in-screen'
import { UnlockScreen } from './auth/unlock-screen'
import type { Session } from './auth/vault-session'
import { VaultScreen } from './vault/vault-screen'

type Screen =
  | { readonly name: 'loading' }
  | { readonly name: 'setup'; readonly notice?: string }
  | { readonly name: 'sign-in' }
  | { readonly name: 'unlock'; readonly meta: CacheMeta; readonly notice?: string }
  | { readonly name: 'vault'; readonly session: Session }

const REVOKED_NOTICE = 'This device was signed out.'

/** Picks the screen: set up or sign in on a new device, unlock when a local copy exists, else the vault. */
export function App() {
  const [cache, setCache] = useState<Cache | undefined>()
  const [screen, setScreen] = useState<Screen>({ name: 'loading' })

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const opened = await openCache()
      const meta = await readMeta(opened)
      if (cancelled) return
      setCache(opened)
      setScreen(meta ? { name: 'unlock', meta } : { name: 'setup' })
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const enterVault = useCallback((session: Session) => setScreen({ name: 'vault', session }), [])

  // Locking drops the session object, and with it the keys held in memory.
  const lock = useCallback(async () => {
    if (!cache) return
    const meta = await readMeta(cache)
    setScreen(meta ? { name: 'unlock', meta } : { name: 'setup' })
  }, [cache])

  const revoke = useCallback(async () => {
    if (!cache) return
    await clearCache(cache)
    setScreen({ name: 'setup', notice: REVOKED_NOTICE })
  }, [cache])

  if (!cache || screen.name === 'loading') {
    return (
      <div className="center-screen" role="status">
        Loading…
      </div>
    )
  }
  switch (screen.name) {
    case 'setup':
      return (
        <SetupScreen
          cache={cache}
          notice={screen.notice}
          onDone={enterVault}
          onSignIn={() => setScreen({ name: 'sign-in' })}
        />
      )
    case 'sign-in':
      return (
        <SignInScreen
          cache={cache}
          onSignedIn={enterVault}
          onSetup={() => setScreen({ name: 'setup' })}
        />
      )
    case 'unlock':
      return (
        <UnlockScreen
          cache={cache}
          meta={screen.meta}
          notice={screen.notice}
          onUnlocked={enterVault}
        />
      )
    case 'vault':
      return <VaultScreen cache={cache} session={screen.session} onLock={lock} onRevoked={revoke} />
  }
}
