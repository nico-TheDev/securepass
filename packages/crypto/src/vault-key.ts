import type { KdfParams } from '@securepass/shared'
import { err, ok, type Result } from '@securepass/shared'
import { fromBase64Url, toBase64Url } from './bytes'
import { open, seal } from './envelope'
import type { CryptoError } from './errors'
import { cryptoError } from './errors'

/** Fixed key order so client and server agree on the bytes. */
const canonicalKdf = (kdf: KdfParams): string =>
  JSON.stringify({ alg: kdf.alg, m: kdf.m, p: kdf.p, t: kdf.t })

/** Binds the wrapped vault key to its account and KDF settings, so swapped settings fail to unlock. */
const vaultKeyAd = (accountId: string, kdf: KdfParams, kdfSalt: Uint8Array): string =>
  `vault-key|${accountId}|${canonicalKdf(kdf)}|${toBase64Url(kdfSalt)}`

/**
 * Seals the vault key under `enc_key`. The AD includes the account id, the KDF settings, and the salt.
 * @returns The envelope as base64url text, ready for JSON.
 */
export const wrapVaultKey = async (
  encKey: Uint8Array,
  vaultKey: Uint8Array,
  accountId: string,
  kdf: KdfParams,
  kdfSalt: Uint8Array,
): Promise<string> => toBase64Url(seal(encKey, vaultKey, vaultKeyAd(accountId, kdf, kdfSalt)))

/**
 * Opens the wrapped vault key. A wrong password, a changed salt, or changed KDF settings all fail here
 * with `Damaged`, which is how a wrong master password is detected.
 */
export const unwrapVaultKey = async (
  encKey: Uint8Array,
  wrapped: string,
  accountId: string,
  kdf: KdfParams,
  kdfSalt: Uint8Array,
): Promise<Result<Uint8Array, CryptoError>> => {
  const bytes = fromBase64Url(wrapped)
  if (!bytes) return err(cryptoError('Damaged', 'Wrapped vault key is not valid base64url'))
  const opened = open(encKey, bytes, vaultKeyAd(accountId, kdf, kdfSalt))
  if (!opened.ok) return opened
  return opened.value.length === 32
    ? ok(opened.value)
    : err(cryptoError('Damaged', 'Vault key has the wrong length'))
}

/**
 * Seals the vault key under the recovery key's `recovery_enc_key`, bound to the account id.
 * @returns The envelope as base64url text, ready for JSON.
 */
export const wrapVaultKeyRecovery = (
  recoveryEncKey: Uint8Array,
  vaultKey: Uint8Array,
  accountId: string,
): string => toBase64Url(seal(recoveryEncKey, vaultKey, `vault-key-recovery|${accountId}`))
