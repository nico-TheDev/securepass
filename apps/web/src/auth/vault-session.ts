import {
  deriveMasterKey,
  KDF_FLOOR,
  newAccountId,
  newKdfSalt,
  newRecoveryKit,
  newVaultKey,
  type RecoveryKit,
  splitKeys,
  toBase64Url,
  wrapVaultKey,
  wrapVaultKeyRecovery,
  zeroize,
} from '@securepass/crypto'
import { err, type KdfParams, ok, type Result, type SetupRequest } from '@securepass/shared'
import { type Cache, type CacheMeta, writeMeta } from '@securepass/shared/cache'
import {
  type SecondProof,
  type Session,
  type SignInError,
  signIn as vaultSignIn,
} from '@securepass/vault'
import { type ApiError, postLogin, postPrelogin, postSetup } from './api'

export {
  type SecondProof,
  type Session,
  type SignInError,
  type UnlockError,
  unlockWithPassword,
} from '@securepass/vault'

/** The name this browser shows in the device list. */
export const DEVICE_NAME = 'Web vault'

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
 * Signs in on a device with no cache: asks the server for the KDF settings, derives the keys here,
 * proves the auth key (plus a TOTP or recovery code once TOTP is on), and opens the wrapped vault
 * key the server returns.
 */
export const signIn = (
  cache: Cache,
  email: string,
  password: string,
  second?: SecondProof,
): Promise<Result<Session, SignInError>> =>
  vaultSignIn({ prelogin: postPrelogin, login: postLogin }, cache, {
    email,
    password,
    second,
    deviceName: DEVICE_NAME,
  })
