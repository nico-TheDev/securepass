import { err, type KdfParams, kdfParamsSchema, ok, type Result } from '@securepass/shared'
import { argon2id } from 'hash-wasm'
import { utf8 } from './bytes'
import { type CryptoError, cryptoError } from './errors'

/** Lowest Argon2id settings a client accepts: 64 MiB, 3 passes, 1 lane. */
export const KDF_FLOOR = { m: 65536, t: 3, p: 1 } as const
/** Highest Argon2id settings a client accepts: 1 GiB, 10 passes, 4 lanes. */
export const KDF_CEILING = { m: 1048576, t: 10, p: 4 } as const

const SALT_LENGTH = 16
const MASTER_KEY_LENGTH = 32

/**
 * Checks KDF settings before every derivation: algorithm, ceiling, floor, then pinning.
 * A value lower than the last accepted settings is refused even if above the floor.
 * @param kdf - Settings received from the server or the cache.
 * @param pinnedKdf - The last settings this device unlocked with, or `undefined` on a new device.
 */
export const assertKdf = (kdf: unknown, pinnedKdf?: KdfParams): Result<KdfParams, CryptoError> => {
  const alg = (kdf as { alg?: unknown } | null)?.alg
  if (alg !== 'argon2id') return err(cryptoError('UnsupportedKdf', 'Only argon2id is supported'))
  const parsed = kdfParamsSchema.safeParse(kdf)
  if (!parsed.success)
    return err(cryptoError('KdfOutOfRange', 'KDF settings are not whole numbers'))
  const { m, t, p } = parsed.data
  if (m > KDF_CEILING.m || t > KDF_CEILING.t || p > KDF_CEILING.p) {
    return err(cryptoError('KdfOutOfRange', 'KDF settings are above the allowed maximum'))
  }
  if (m < KDF_FLOOR.m || t < KDF_FLOOR.t || p < KDF_FLOOR.p) {
    return err(cryptoError('WeakKdf', 'KDF settings are below the allowed minimum'))
  }
  if (pinnedKdf && (m < pinnedKdf.m || t < pinnedKdf.t || p < pinnedKdf.p)) {
    return err(cryptoError('KdfDowngrade', 'KDF settings are lower than the ones last used'))
  }
  return ok(parsed.data)
}

/** Input for {@link deriveMasterKey}. */
export type DeriveMasterKeyInput = {
  readonly password: string
  readonly kdf: unknown
  /** 16 random bytes, from prelogin or the cache `meta`. */
  readonly kdfSalt: Uint8Array
  readonly pinnedKdf?: KdfParams | undefined
}

/**
 * Stretches the master password with Argon2id into a 32 byte master key.
 * The password is NFC normalized first. `assertKdf` runs before anything is derived.
 * Runs in a page context, never in an MV3 service worker.
 * @param input - Password, KDF settings, salt, and the pinned settings if any.
 */
export const deriveMasterKey = async (
  input: DeriveMasterKeyInput,
): Promise<Result<Uint8Array, CryptoError>> => {
  const checked = assertKdf(input.kdf, input.pinnedKdf)
  if (!checked.ok) return checked
  if (input.kdfSalt.length !== SALT_LENGTH)
    return err(cryptoError('InvalidInput', 'KDF salt must be 16 bytes'))
  const { m, t, p } = checked.value
  const key = await argon2id({
    password: utf8(input.password.normalize('NFC')),
    salt: input.kdfSalt,
    parallelism: p,
    iterations: t,
    memorySize: m,
    hashLength: MASTER_KEY_LENGTH,
    outputType: 'binary',
  })
  return ok(key)
}
