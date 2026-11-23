import { type Cache, type CacheMeta, clearCache, readMeta } from '@securepass/shared/cache'
import { loadVaultItems, reauthenticate, type VaultItem } from '@securepass/vault'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { browser } from 'wxt/browser'
import { checkPage } from '../fill/rules'
import { clearLastUsed, DEVICE_NAME } from '../local-store'
import { hasPin } from '../lock/pin'
import {
  clearSession,
  onSessionChange,
  readSession,
  type SyncState,
  type UnlockMethod,
  writeSession,
} from '../session-store'
import { api, send, signInErrorText } from './background'
import { PasswordField, TextField } from './fields'
import { Generator } from './generator'
import { ItemList } from './item-list'
import { Settings } from './settings'

type Props = {
  readonly cache: Cache
  readonly meta: CacheMeta
  readonly vaultKey: Uint8Array
  readonly method: UnlockMethod
}

type Tab = 'items' | 'generator' | 'settings'
const TABS: readonly (readonly [Tab, string])[] = [
  ['items', 'Vault'],
  ['generator', 'Generator'],
  ['settings', 'Settings'],
]

const statusText = (sync: SyncState | undefined): string => {
  switch (sync?.state) {
    case undefined:
      return 'Not synced yet'
    case 'syncing':
      return 'Syncing…'
    case 'synced':
      return `Synced at ${new Date(sync.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    case 'offline':
      return 'Offline. Using the copy on this device.'
    case 'expired':
      return 'Session expired. Your changes are kept.'
    case 'attention':
      return 'Sync needs attention. Your changes are kept.'
  }
}

/** The origin of the active tab when it is an `https` page, for the "This site" ordering. */
const activePageOrigin = async (): Promise<string | null> => {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true })
    const page = checkPage({
      senderOrigin: tab?.url ? new URL(tab.url).origin : undefined,
      topUrl: tab?.url,
      frameUrl: tab?.url,
    })
    return page.ok ? page.value : null
  } catch {
    return null
  }
}

/** The unlocked popup: sync status, lock, the item list, the generator, and settings. */
export function Vault({ cache, meta, vaultKey, method }: Props) {
  const [tab, setTab] = useState<Tab>('items')
  const [items, setItems] = useState<readonly VaultItem[] | undefined>()
  const [sync, setSync] = useState<SyncState | undefined>()
  const [pinSet, setPinSet] = useState(false)
  const [pageOrigin, setPageOrigin] = useState<string | null>(null)

  const reload = useCallback(async () => {
    setSync((await readSession('sync_state')).sync_state)
    setPinSet(await hasPin())
    setItems(await loadVaultItems(cache, vaultKey))
  }, [cache, vaultKey])

  useEffect(() => {
    void reload()
    void activePageOrigin().then(setPageOrigin)
    return onSessionChange(() => void reload())
  }, [reload])

  const signOut = async () => {
    const token = (await readMeta(cache))?.token
    if (token) await api.logout(token)
    await clearCache(cache)
    await clearSession()
    await clearLastUsed()
    await writeSession({ notice: 'You signed out of this extension.' })
  }

  return (
    <div className="vault">
      <header className="toolbar">
        <strong className="brand">securepass</strong>
        <p className="status" role="status">
          {statusText(sync)}
        </p>
        <button className="btn btn-small" type="button" onClick={() => void send({ type: 'lock' })}>
          Lock
        </button>
      </header>
      <nav aria-label="Sections" className="nav">
        {TABS.map(([name, label]) => (
          <button
            key={name}
            type="button"
            className="nav-link"
            aria-current={tab === name ? 'page' : undefined}
            onClick={() => setTab(name)}
          >
            {label}
          </button>
        ))}
      </nav>
      {sync?.state === 'expired' ? <SignInAgain cache={cache} /> : null}
      <main className="screen">
        {tab === 'items' ? <ItemList items={items} pageOrigin={pageOrigin} /> : null}
        {tab === 'generator' ? <Generator /> : null}
        {tab === 'settings' ? (
          <Settings
            vaultKey={vaultKey}
            email={meta.email}
            method={method}
            pinSet={pinSet}
            onPinChange={() => void reload()}
            onSignOut={() => void signOut()}
          />
        ) : null}
      </main>
    </div>
  )
}

/** Shown when the session merely expired: the cache and queued edits stay, you log in again. */
function SignInAgain({ cache }: { readonly cache: Cache }) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setWorking(true)
    const result = await reauthenticate(api, cache, password, { totp_code: code }, DEVICE_NAME)
    setWorking(false)
    setPassword('')
    setCode('')
    if (result.ok) await send({ type: 'sync' })
    else setError(signInErrorText(result.error))
  }

  return (
    <form className="banner form" onSubmit={submit} aria-busy={working}>
      <p role="alert">
        Your session has ended. Your vault and unsent changes are safe on this device, but they will
        not sync until you sign in again.
      </p>
      <PasswordField
        label="Master password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        required
        disabled={working}
      />
      <TextField
        label="Authenticator code"
        value={code}
        onChange={setCode}
        autoComplete="one-time-code"
        inputMode="numeric"
        disabled={working}
      />
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={working || password === ''}>
        {working ? 'Signing in…' : 'Sign in again'}
      </button>
    </form>
  )
}
