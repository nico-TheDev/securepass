import {
  assertKdf,
  deriveMasterKey,
  fromBase64Url,
  KDF_FLOOR,
  newKdfSalt,
  newRecoveryKit,
  parseRecoveryKey,
  type RecoveryKit,
  splitKeys,
  toBase64Url,
  unwrapVaultKey,
  unwrapVaultKeyRecovery,
  wrapVaultKey,
  wrapVaultKeyRecovery,
  zeroize,
} from '@securepass/crypto'
import { err, type KdfParams, ok, type Result } from '@securepass/shared'
import { type Cache, type CacheMeta, readMeta, writeMeta } from '@securepass/shared/cache'
import type { ApiClient, ApiError } from './api'

/** An unlocked vault: the keys live only here, in memory, and are dropped on lock. */
export type Session = { readonly vaultKey: Uint8Array; readonly meta: CacheMeta }

/** The second proof a login or recovery carries once TOTP is on. */
export type SecondProof = {
  readonly totp_code?: string | undefined
  readonly recovery_code?: string | undefined
}

export type UnlockError = { readonly kind: 'wrong_password' } | { readonly kind: 'crypto' }

/** Why a call that proves credentials to the server failed. */
export type SignInError =
  | { readonly kind: 'wrong_credentials' }
  | { readonly kind: 'rate_limited'; readonly retryAfter: number }
  | { readonly kind: 'network' }
  | { readonly kind: 'crypto' }
  | { readonly kind: 'server' }

/** Lets the browser paint "working" before a long derivation blocks the main thread. */
const nextFrame = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 30))

/** Maps a failed credential call to what the user is told. */
export const signInFailure = (error: ApiError): SignInError => {
  if (error.kind === 'network') return { kind: 'network' }
  if (error.status === 401) return { kind: 'wrong_credentials' }
  if (error.status === 429) return { kind: 'rate_limited', retryAfter: error.retryAfter ?? 60 }
  return { kind: 'server' }
}

/** Keeps only the proof fields that were filled in, with spaces removed from a TOTP code. */
const cleanProof = (second: SecondProof | undefined): SecondProof => {
  const totp = second?.totp_code?.replaceAll(/\s/g, '') ?? ''
  const recovery = second?.recovery_code?.trim() ?? ''
  return {
    ...(totp === '' ? {} : { totp_code: totp }),
    ...(recovery === '' ? {} : { recovery_code: recovery }),
  }
}

/**
 * Stretches the master password and splits the result. `assertKdf` (floor, ceiling, pinning)
 * runs inside the derivation, so refused settings never produce a key.
 */
const deriveKeys = async (
  password: string,
  kdf: unknown,
  kdfSalt: Uint8Array,
  pinnedKdf?: KdfParams,
): Promise<
  Result<{ readonly enc_key: Uint8Array; readonly auth_key: Uint8Array }, UnlockError>
> => {
  await nextFrame()
  const master = await deriveMasterKey({ password, kdf, kdfSalt, pinnedKdf })
  if (!master.ok) return err({ kind: 'crypto' })
  const keys = await splitKeys(master.value)
  zeroize(master.value)
  return ok(keys)
}

/**
 * Unlocks from the local cache with no server call. A wrong password fails the vault key tamper
 * check, and the caller shows one message for it. A newly accepted KDF setting is pinned after
 * success.
 */
export const unlockWithPassword = async (
  cache: Cache,
  meta: CacheMeta,
  password: string,
): Promise<Result<Session, UnlockError>> => {
  const salt = fromBase64Url(meta.kdf_salt)
  if (!salt) return err({ kind: 'crypto' })
  const keys = await deriveKeys(password, meta.kdf, salt, meta.pinned_kdf)
  if (!keys.ok) return keys
  zeroize(keys.value.auth_key)
  const vaultKey = await unwrapVaultKey(
    keys.value.enc_key,
    meta.wrapped_vault_key,
    meta.account_id,
    meta.kdf,
    salt,
  )
  zeroize(keys.value.enc_key)
  if (!vaultKey.ok) return err({ kind: 'wrong_password' })

  const next: CacheMeta = { ...meta, pinned_kdf: meta.kdf }
  if (meta.pinned_kdf === undefined) await writeMeta(cache, next)
  return ok({ vaultKey: vaultKey.value, meta: next })
}

/** What {@link signIn} needs to know about the device and the person. */
export type SignInInput = {
  readonly email: string
  readonly password: string
  readonly second?: SecondProof | undefined
  /** The name this device shows in the device list. */
  readonly deviceName: string
  /** A device id made earlier (the extension keeps one), else a new one is made. */
  readonly deviceId?: string | undefined
}

/**
 * Signs in on a device with no cache: asks the server for the KDF settings, derives the keys here,
 * proves the auth key (plus a TOTP or recovery code once TOTP is on), and opens the wrapped vault
 * key the server returns. The master password is never sent.
 */
export const signIn = async (
  api: Pick<ApiClient, 'prelogin' | 'login'>,
  cache: Cache,
  input: SignInInput,
): Promise<Result<Session, SignInError>> => {
  const email = input.email.trim().toLowerCase()
  const prelogin = await api.prelogin(email)
  if (!prelogin.ok) {
    const failure = signInFailure(prelogin.error)
    return err(failure.kind === 'wrong_credentials' ? { kind: 'server' } : failure)
  }
  const { kdf, kdf_salt } = prelogin.value
  const checked = assertKdf(kdf)
  const salt = fromBase64Url(kdf_salt)
  if (!checked.ok || !salt) return err({ kind: 'crypto' })

  const keys = await deriveKeys(input.password, checked.value, salt)
  if (!keys.ok) return err({ kind: 'crypto' })
  const { enc_key, auth_key } = keys.value

  const login = await api.login({
    email,
    auth_key: toBase64Url(auth_key),
    device_name: input.deviceName,
    ...cleanProof(input.second),
  })
  zeroize(auth_key)
  if (!login.ok) {
    zeroize(enc_key)
    return err(signInFailure(login.error))
  }

  const { token, account_id, wrapped_vault_key } = login.value
  const vaultKey = await unwrapVaultKey(enc_key, wrapped_vault_key, account_id, checked.value, salt)
  zeroize(enc_key)
  if (!vaultKey.ok) return err({ kind: 'crypto' })

  const meta: CacheMeta = {
    account_id,
    email,
    kdf: checked.value,
    kdf_salt,
    pinned_kdf: checked.value,
    wrapped_vault_key,
    // Start at 0 so the first sync pulls every item.
    last_revision: 0,
    token,
    device_id: input.deviceId ?? crypto.randomUUID(),
    seen_seq: {},
  }
  await writeMeta(cache, meta)
  return ok({ vaultKey: vaultKey.value, meta })
}

/**
 * Logs in again after the session expired, keeping the cache and every queued edit. The password
 * is checked against the local wrapped vault key first, so a typo never reaches the server.
 * @returns The cache record with the new device token.
 */
export const reauthenticate = async (
  api: Pick<ApiClient, 'login'>,
  cache: Cache,
  password: string,
  second: SecondProof | undefined,
  deviceName: string,
): Promise<Result<CacheMeta, SignInError>> => {
  const meta = await readMeta(cache)
  const salt = meta ? fromBase64Url(meta.kdf_salt) : null
  if (!meta || !salt) return err({ kind: 'crypto' })
  const keys = await deriveKeys(password, meta.kdf, salt, meta.pinned_kdf)
  if (!keys.ok) return err({ kind: 'crypto' })
  const { enc_key, auth_key } = keys.value
  const local = await unwrapVaultKey(
    enc_key,
    meta.wrapped_vault_key,
    meta.account_id,
    meta.kdf,
    salt,
  )
  zeroize(enc_key)
  if (!local.ok) {
    zeroize(auth_key)
    return err({ kind: 'wrong_credentials' })
  }
  zeroize(local.value)

  const login = await api.login({
    email: meta.email,
    auth_key: toBase64Url(auth_key),
    device_name: deviceName,
    ...cleanProof(second),
  })
  zeroize(auth_key)
  if (!login.ok) return err(signInFailure(login.error))

  const latest = (await readMeta(cache)) ?? meta
  const next: CacheMeta = { ...latest, token: login.value.token }
  await writeMeta(cache, next)
  return ok(next)
}

/** The new password's keys and the vault key wrapped under them. */
const wrapForNewPassword = async (
  password: string,
  vaultKey: Uint8Array,
  accountId: string,
): Promise<
  Result<
    {
      readonly kdf: KdfParams
      readonly kdf_salt: string
      readonly auth_key: string
      readonly wrapped_vault_key: string
    },
    UnlockError
  >
> => {
  const kdf: KdfParams = { alg: 'argon2id', ...KDF_FLOOR }
  const salt = newKdfSalt()
  const keys = await deriveKeys(password, kdf, salt)
  if (!keys.ok) return keys
  const wrapped = await wrapVaultKey(keys.value.enc_key, vaultKey, accountId, kdf, salt)
  zeroize(keys.value.enc_key)
  const authKey = toBase64Url(keys.value.auth_key)
  zeroize(keys.value.auth_key)
  return ok({ kdf, kdf_salt: toBase64Url(salt), auth_key: authKey, wrapped_vault_key: wrapped })
}

/**
 * Changes the master password while signed in: the same vault key is wrapped under the new
 * password with a new salt, the auth key rotates, and the server signs out every other device.
 * Item ciphertexts do not change.
 * @param totpCode - A fresh TOTP code.
 * @returns The session with this device's new token and settings.
 */
export const changeMasterPassword = async (
  api: Pick<ApiClient, 'changePassword'>,
  cache: Cache,
  session: Session,
  currentPassword: string,
  newPassword: string,
  totpCode: string,
): Promise<Result<Session, SignInError>> => {
  const meta = (await readMeta(cache)) ?? session.meta
  const salt = fromBase64Url(meta.kdf_salt)
  if (!salt) return err({ kind: 'crypto' })
  const current = await deriveKeys(currentPassword, meta.kdf, salt, meta.pinned_kdf)
  if (!current.ok) return err({ kind: 'crypto' })
  const check = await unwrapVaultKey(
    current.value.enc_key,
    meta.wrapped_vault_key,
    meta.account_id,
    meta.kdf,
    salt,
  )
  zeroize(current.value.enc_key)
  if (!check.ok) {
    zeroize(current.value.auth_key)
    return err({ kind: 'wrong_credentials' })
  }
  zeroize(check.value)

  const wrapped = await wrapForNewPassword(newPassword, session.vaultKey, meta.account_id)
  if (!wrapped.ok) return err({ kind: 'crypto' })
  const reply = await api.changePassword(meta.token, {
    ...wrapped.value,
    current_auth_key: toBase64Url(current.value.auth_key),
    ...cleanProof({ totp_code: totpCode }),
  })
  zeroize(current.value.auth_key)
  if (!reply.ok) return err(signInFailure(reply.error))

  const latest = (await readMeta(cache)) ?? meta
  const next: CacheMeta = {
    ...latest,
    kdf: wrapped.value.kdf,
    kdf_salt: wrapped.value.kdf_salt,
    pinned_kdf: wrapped.value.kdf,
    wrapped_vault_key: wrapped.value.wrapped_vault_key,
    token: reply.value.token,
  }
  await writeMeta(cache, next)
  return ok({ vaultKey: session.vaultKey, meta: next })
}

/** A recovery that passed the server's checks and now waits for a new master password. */
export type PendingRecovery = {
  readonly email: string
  readonly accountId: string
  readonly vaultKey: Uint8Array
  readonly recoveryToken: string
}

/**
 * First half of recovery: proves the recovery key plus a TOTP or recovery code, and opens the
 * vault key with the recovery key. The recovery key itself never leaves the device.
 * @param recoveryKeyText - The key as typed from the recovery kit.
 */
export const startRecovery = async (
  api: Pick<ApiClient, 'recover'>,
  email: string,
  recoveryKeyText: string,
  second: SecondProof,
): Promise<Result<PendingRecovery, SignInError | { readonly kind: 'bad_recovery_key' }>> => {
  const kit = await parseRecoveryKey(recoveryKeyText)
  if (!kit.ok) return err({ kind: 'bad_recovery_key' })
  const normalized = email.trim().toLowerCase()
  const reply = await api.recover({
    email: normalized,
    recovery_auth_key: toBase64Url(kit.value.recovery_auth_key),
    ...cleanProof(second),
  })
  if (!reply.ok) return err(signInFailure(reply.error))
  const vaultKey = unwrapVaultKeyRecovery(
    kit.value.recovery_enc_key,
    reply.value.wrapped_vault_key_recovery,
    reply.value.account_id,
  )
  zeroize(kit.value.recovery_key)
  zeroize(kit.value.recovery_enc_key)
  if (!vaultKey.ok) return err({ kind: 'crypto' })
  return ok({
    email: normalized,
    accountId: reply.value.account_id,
    vaultKey: vaultKey.value,
    recoveryToken: reply.value.recovery_token,
  })
}

/** What a finished recovery hands back: the session, the new kit, and 10 new recovery codes. */
export type FinishedRecovery = {
  readonly session: Session
  readonly kit: RecoveryKit
  readonly recoveryCodes: readonly string[]
}

/**
 * Second half of recovery: sets the new master password and a brand new recovery kit. The old kit
 * stops working, every session is signed out, and this device gets a fresh one.
 */
export const finishRecovery = async (
  api: Pick<ApiClient, 'changePassword'>,
  cache: Cache,
  pending: PendingRecovery,
  newPassword: string,
  deviceName: string,
): Promise<Result<FinishedRecovery, SignInError>> => {
  const wrapped = await wrapForNewPassword(newPassword, pending.vaultKey, pending.accountId)
  if (!wrapped.ok) return err({ kind: 'crypto' })
  const kit = await newRecoveryKit()
  const reply = await api.changePassword(undefined, {
    ...wrapped.value,
    recovery_token: pending.recoveryToken,
    recovery_auth_key: toBase64Url(kit.recovery_auth_key),
    wrapped_vault_key_recovery: wrapVaultKeyRecovery(
      kit.recovery_enc_key,
      pending.vaultKey,
      pending.accountId,
    ),
    device_name: deviceName,
  })
  if (!reply.ok) return err(signInFailure(reply.error))

  // A cache from before the recovery belongs to the same account: keep its items and queue.
  const previous = await readMeta(cache)
  const keep = previous?.account_id === pending.accountId ? previous : undefined
  const meta: CacheMeta = {
    account_id: pending.accountId,
    email: pending.email,
    kdf: wrapped.value.kdf,
    kdf_salt: wrapped.value.kdf_salt,
    pinned_kdf: wrapped.value.kdf,
    wrapped_vault_key: wrapped.value.wrapped_vault_key,
    last_revision: keep?.last_revision ?? 0,
    token: reply.value.token,
    device_id: keep?.device_id ?? crypto.randomUUID(),
    seen_seq: keep?.seen_seq ?? {},
    totp_enrolled: true,
  }
  await writeMeta(cache, meta)
  return ok({
    session: { vaultKey: pending.vaultKey, meta },
    kit,
    recoveryCodes: reply.value.recovery_codes ?? [],
  })
}
