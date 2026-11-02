import {
  assertKdf,
  deriveMasterKey,
  fromBase64Url,
  KDF_FLOOR,
  newAccountId,
  newKdfSalt,
  newRecoveryKit,
  newVaultKey,
  type RecoveryKit,
  splitKeys,
  toBase64Url,
  unwrapVaultKey,
  wrapVaultKey,
  wrapVaultKeyRecovery,
  zeroize,
} from '@securepass/crypto'
import { err, type KdfParams, ok, type Result, type SetupRequest } from '@securepass/shared'
import { type Cache, type CacheMeta, writeMeta } from '@securepass/shared/cache'
import { type ApiError, postLogin, postPrelogin, postSetup } from './api'

/** The name this browser shows in the device list. */
const DEVICE_NAME = 'Web vault'

/** An unlocked vault: the keys live only here, in memory, and are dropped on lock. */
export type Session = { readonly vaultKey: Uint8Array; readonly meta: CacheMeta }

/** Everything setup made, held in memory until the user confirms the recovery kit. */
export type PendingSetup = {
  readonly request: SetupRequest
  readonly kit: RecoveryKit
  readonly vaultKey: Uint8Array
  readonly deviceId: string
  readonly kdf: KdfParams
}

export type SetupError =
  | { readonly kind: 'crypto' }
  | { readonly kind: 'bad_token' }
  | { readonly kind: 'account_exists' }
  | { readonly kind: 'network' }
  | { readonly kind: 'server' }

export type UnlockError = { readonly kind: 'wrong_password' } | { readonly kind: 'crypto' }

export type SignInError =
  | { readonly kind: 'wrong_credentials' }
  | { readonly kind: 'network' }
  | { readonly kind: 'crypto' }
  | { readonly kind: 'server' }

/** Lets the browser paint "working" before a long derivation blocks the main thread. */
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30))

/**
 * Makes every key and proof a new account needs, on this device. Nothing is sent yet.
 * The master password is only read here and never stored.
 */
export const prepareSetup = async (
  email: string,
  password: string,
): Promise<Result<PendingSetup, SetupError>> => {
  await nextFrame()
  const kdf: KdfParams = { alg: 'argon2id', ...KDF_FLOOR }
  const kdfSalt = newKdfSalt()
  const master = await deriveMasterKey({ password, kdf, kdfSalt })
  if (!master.ok) return err({ kind: 'crypto' })
  const { enc_key, auth_key } = await splitKeys(master.value)
  zeroize(master.value)

  const accountId = newAccountId()
  const vaultKey = newVaultKey()
  const kit = await newRecoveryKit()
  const wrapped = await wrapVaultKey(enc_key, vaultKey, accountId, kdf, kdfSalt)
  zeroize(enc_key)

  return ok({
    kit,
    vaultKey,
    kdf,
    deviceId: crypto.randomUUID(),
    request: {
      account_id: accountId,
      email: email.trim().toLowerCase(),
      kdf,
      kdf_salt: toBase64Url(kdfSalt),
      auth_key: toBase64Url(auth_key),
      recovery_auth_key: toBase64Url(kit.recovery_auth_key),
      wrapped_vault_key: wrapped,
      wrapped_vault_key_recovery: wrapVaultKeyRecovery(kit.recovery_enc_key, vaultKey, accountId),
      device_name: DEVICE_NAME,
    },
  })
}

const setupFailure = (error: ApiError): SetupError => {
  if (error.kind === 'network') return { kind: 'network' }
  if (error.status === 401) return { kind: 'bad_token' }
  if (error.status === 409) return { kind: 'account_exists' }
  return { kind: 'server' }
}

/**
 * Sends the setup request, then saves the account in the local cache and returns the unlocked session.
 * Called only after the user has confirmed the recovery kit.
 */
export const completeSetup = async (
  cache: Cache,
  pending: PendingSetup,
  setupToken: string,
): Promise<Result<Session, SetupError>> => {
  const response = await postSetup(setupToken.trim(), pending.request)
  if (!response.ok) return err(setupFailure(response.error))
  const { request } = pending
  const meta: CacheMeta = {
    account_id: request.account_id,
    email: request.email,
    kdf: pending.kdf,
    kdf_salt: request.kdf_salt,
    pinned_kdf: pending.kdf,
    wrapped_vault_key: request.wrapped_vault_key,
    last_revision: 0,
    token: response.value.token,
    device_id: pending.deviceId,
    seen_seq: {},
  }
  await writeMeta(cache, meta)
  return ok({ vaultKey: pending.vaultKey, meta })
}

/**
 * Unlocks from the local cache with no server call. A wrong password fails the vault key tamper check,
 * and the caller shows one message for it. A newly accepted KDF setting is pinned after success.
 */
export const unlockWithPassword = async (
  cache: Cache,
  meta: CacheMeta,
  password: string,
): Promise<Result<Session, UnlockError>> => {
  await nextFrame()
  const salt = fromBase64Url(meta.kdf_salt)
  if (!salt) return err({ kind: 'crypto' })
  const master = await deriveMasterKey({
    password,
    kdf: meta.kdf,
    kdfSalt: salt,
    pinnedKdf: meta.pinned_kdf,
  })
  if (!master.ok) return err({ kind: 'crypto' })
  const { enc_key } = await splitKeys(master.value)
  zeroize(master.value)
  const vaultKey = await unwrapVaultKey(
    enc_key,
    meta.wrapped_vault_key,
    meta.account_id,
    meta.kdf,
    salt,
  )
  zeroize(enc_key)
  if (!vaultKey.ok) return err({ kind: 'wrong_password' })

  const next: CacheMeta = { ...meta, pinned_kdf: meta.kdf }
  if (meta.pinned_kdf === undefined) await writeMeta(cache, next)
  return ok({ vaultKey: vaultKey.value, meta: next })
}

/**
 * Signs in on a device with no cache: asks the server for the KDF settings, derives the keys here,
 * proves the auth key, and opens the wrapped vault key the server returns.
 */
export const signIn = async (
  cache: Cache,
  email: string,
  password: string,
): Promise<Result<Session, SignInError>> => {
  const normalized = email.trim().toLowerCase()
  const prelogin = await postPrelogin(normalized)
  if (!prelogin.ok)
    return err(prelogin.error.kind === 'network' ? { kind: 'network' } : { kind: 'server' })
  const { kdf, kdf_salt } = prelogin.value

  const checked = assertKdf(kdf)
  const salt = fromBase64Url(kdf_salt)
  if (!checked.ok || !salt) return err({ kind: 'crypto' })

  await nextFrame()
  const master = await deriveMasterKey({ password, kdf: checked.value, kdfSalt: salt })
  if (!master.ok) return err({ kind: 'crypto' })
  const { enc_key, auth_key } = await splitKeys(master.value)
  zeroize(master.value)

  const login = await postLogin({
    email: normalized,
    auth_key: toBase64Url(auth_key),
    device_name: DEVICE_NAME,
  })
  zeroize(auth_key)
  if (!login.ok) {
    zeroize(enc_key)
    if (login.error.kind === 'network') return err({ kind: 'network' })
    return err(login.error.status === 401 ? { kind: 'wrong_credentials' } : { kind: 'server' })
  }

  const { token, account_id, wrapped_vault_key } = login.value
  const vaultKey = await unwrapVaultKey(enc_key, wrapped_vault_key, account_id, checked.value, salt)
  zeroize(enc_key)
  if (!vaultKey.ok) return err({ kind: 'crypto' })

  const meta: CacheMeta = {
    account_id,
    email: normalized,
    kdf: checked.value,
    kdf_salt,
    pinned_kdf: checked.value,
    wrapped_vault_key,
    // Start at 0 so the first sync pulls every item.
    last_revision: 0,
    token,
    device_id: crypto.randomUUID(),
    seen_seq: {},
  }
  await writeMeta(cache, meta)
  return ok({ vaultKey: vaultKey.value, meta })
}
