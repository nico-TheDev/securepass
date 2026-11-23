import { fromBase64Url, toBase64Url } from '@securepass/crypto'
import { browser } from 'wxt/browser'

/** How the last sync round went, for the popup's status line. */
export type SyncState =
  | { readonly state: 'syncing' }
  | { readonly state: 'synced'; readonly at: number }
  | { readonly state: 'offline' }
  | { readonly state: 'expired' }
  | { readonly state: 'attention' }

/** How the vault was last unlocked. A PIN can only be set after a master password unlock. */
export type UnlockMethod = 'password' | 'pin'

/** A login captured from a page, waiting for you to confirm the save. Memory only. */
export type PendingSave = {
  readonly origin: string
  /** The frame URL at submit time, saved on a new item. */
  readonly url: string
  readonly username: string
  /** The password to save: the new one on a change password form. */
  readonly password: string
  /** The old password typed on a change password form. */
  readonly previous?: string
  readonly captured_at: number
}

/**
 * Everything the extension keeps in `chrome.storage.session`: memory only, cleared when the
 * browser closes, and readable by extension pages only (the default access level is never raised).
 */
export type SessionValues = {
  readonly vault_key: string
  readonly unlocked_with: UnlockMethod
  readonly last_activity_at: number
  readonly pin_wrapped_vault_key: string
  readonly pin_salt: string
  readonly pin_failures: number
  readonly sync_state: SyncState
  readonly pending_saves: Readonly<Record<string, PendingSave>>
  readonly clipboard_digest: string
  readonly notice: string
}

type Key = keyof SessionValues

/** Reads the named session values. Missing ones are absent from the result. */
export const readSession = async <K extends Key>(
  ...keys: readonly K[]
): Promise<Partial<Pick<SessionValues, K>>> =>
  (await browser.storage.session.get([...keys])) as Partial<Pick<SessionValues, K>>

/** Writes session values. */
export const writeSession = (values: Partial<SessionValues>): Promise<void> =>
  browser.storage.session.set(values)

/** Removes session values. */
export const removeSession = (...keys: readonly Key[]): Promise<void> =>
  browser.storage.session.remove([...keys])

/** The unlocked vault key, or `null` while locked. */
export const readVaultKey = async (): Promise<Uint8Array | null> => {
  const { vault_key } = await readSession('vault_key')
  return vault_key ? fromBase64Url(vault_key) : null
}

/** Stores the unlocked vault key in browser memory and starts the activity clock. */
export const storeUnlock = (
  vaultKey: Uint8Array,
  method: UnlockMethod,
  now: number,
): Promise<void> =>
  writeSession({
    vault_key: toBase64Url(vaultKey),
    unlocked_with: method,
    last_activity_at: now,
  })

/** Records extension activity (popup open, suggestion shown, fill, save), which delays the lock. */
export const touchActivity = (now: number): Promise<void> => writeSession({ last_activity_at: now })

/** Removes the unlocked key. The PIN wrap stays, so a PIN can unlock again in this session. */
export const clearUnlock = (): Promise<void> => removeSession('vault_key', 'unlocked_with')

/** Removes everything, for a device that was signed out. */
export const clearSession = (): Promise<void> => browser.storage.session.clear()

/** Calls `listener` whenever any session value changes. Returns a function that stops it. */
export const onSessionChange = (listener: () => void): (() => void) => {
  const handler = () => listener()
  browser.storage.session.onChanged.addListener(handler)
  return () => browser.storage.session.onChanged.removeListener(handler)
}
