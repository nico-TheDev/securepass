import { zeroize } from '@securepass/crypto'
import {
  type Cache,
  type CacheMeta,
  clearCache,
  openCache,
  readMeta,
} from '@securepass/shared/cache'
import { useCallback, useEffect, useState } from 'react'
import { RecoverScreen } from './auth/recover-screen'
import { SetupScreen } from './auth/setup-screen'
import { SignInScreen } from './auth/sign-in-screen'
import { TotpEnrollScreen } from './auth/totp-enroll-screen'
import { UnlockScreen } from './auth/unlock-screen'
import type { Session } from './auth/vault-session'
import { VaultScreen } from './vault/vault-screen'

type Screen =
  | { readonly name: 'loading' }
  | { readonly name: 'setup'; readonly notice?: string }
  | { readonly name: 'sign-in' }
  | { readonly name: 'recover'; readonly email?: string | undefined }
  | { readonly name: 'unlock'; readonly meta: CacheMeta; readonly notice?: string }
  | { readonly name: 'enroll'; readonly session: Session }
  | { readonly name: 'vault'; readonly session: Session }

const REVOKED_NOTICE = 'This device was signed out.'

/**
 * Picks the screen: set up or sign in on a new device, unlock when a local copy exists, the forced
 * two step login enrollment once after setup, then the vault.
 */
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

  // Until this device knows two step login is on, it asks the server before opening the vault.
  const enterVault = useCallback(
    (session: Session) =>
      setScreen(
        session.meta.totp_enrolled ? { name: 'vault', session } : { name: 'enroll', session },
      ),
    [],
  )
  const openVault = useCallback((session: Session) => setScreen({ name: 'vault', session }), [])

  const showLocked = useCallback(async (opened: Cache, next?: (meta: CacheMeta) => Screen) => {
    const meta = await readMeta(opened)
    setScreen(meta ? (next?.(meta) ?? { name: 'unlock', meta }) : { name: 'setup' })
  }, [])

  // Locking drops the session object and overwrites the key it held (best effort in JavaScript).
  const lock = useCallback(async () => {
    if (!cache) return
    setScreen((current) => {
      if (current.name === 'vault' || current.name === 'enroll') zeroize(current.session.vaultKey)
      return current
    })
    await showLocked(cache)
  }, [cache, showLocked])

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
          onRecover={() => setScreen({ name: 'recover' })}
        />
      )
    case 'recover':
      return (
        <RecoverScreen
          cache={cache}
          email={screen.email}
          onRecovered={openVault}
          onCancel={() => void showLocked(cache)}
        />
      )
    case 'unlock':
      return (
        <UnlockScreen
          cache={cache}
          meta={screen.meta}
          notice={screen.notice}
          onUnlocked={enterVault}
          onRecover={() => setScreen({ name: 'recover', email: screen.meta.email })}
        />
      )
    case 'enroll':
      return <TotpEnrollScreen cache={cache} session={screen.session} onDone={openVault} />
    case 'vault':
      return (
        <VaultScreen
          cache={cache}
          session={screen.session}
          onLock={lock}
          onRevoked={revoke}
          onSessionChange={openVault}
          onRecover={() => {
            zeroize(screen.session.vaultKey)
            setScreen({ name: 'recover', email: screen.session.meta.email })
          }}
        />
      )
  }
}
