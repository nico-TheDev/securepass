import { err, ok, type Result } from '@securepass/shared'
import { fromBase64Url, randomBytes } from './bytes'
import { open } from './envelope'
import { type CryptoError, cryptoError } from './errors'
import { hkdf } from './keys'

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
const GROUP_SIZE = 4

/** RFC 4648 Base32 without padding. */
const toBase32 = (bytes: Uint8Array): string => {
  let bits = 0
  let value = 0
  let out = ''
  for (const byte of bytes) {
    value = (value << 8) | byte
    bits += 8
    while (bits >= 5) {
      out += BASE32_ALPHABET[(value >>> (bits - 5)) & 31]
      bits -= 5
    }
  }
  if (bits > 0) out += BASE32_ALPHABET[(value << (5 - bits)) & 31]
  return out
}

/** A new recovery kit's key material. `groups` and `display` are what the user sees and keeps. */
export type RecoveryKit = {
  /** The 32 random bytes. Never sent anywhere. */
  readonly recovery_key: Uint8Array
  /** The key as Base32 split into groups of 4 characters. */
  readonly groups: readonly string[]
  /** The groups joined with dashes, for the kit file. */
  readonly display: string
  /** Login proof for recovery. The only recovery value that is sent to the server. */
  readonly recovery_auth_key: Uint8Array
  /** Wraps the vault key for recovery. Never leaves the device. */
  readonly recovery_enc_key: Uint8Array
}

/** RFC 4648 Base32 decode. Returns `null` for any character outside the alphabet. */
const fromBase32 = (text: string): Uint8Array | null => {
  let bits = 0
  let value = 0
  const out: number[] = []
  for (const char of text) {
    const index = BASE32_ALPHABET.indexOf(char)
    if (index < 0) return null
    value = ((value << 5) | index) & 0xfff
    bits += 5
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 0xff)
      bits -= 8
    }
  }
  return Uint8Array.from(out)
}

const RECOVERY_KEY_LENGTH = 32
/** 32 bytes are 52 Base32 characters. */
const RECOVERY_KEY_CHARS = 52

const kitFromKey = async (recoveryKey: Uint8Array): Promise<RecoveryKit> => {
  const text = toBase32(recoveryKey)
  const groups = Array.from({ length: Math.ceil(text.length / GROUP_SIZE) }, (_, i) =>
    text.slice(i * GROUP_SIZE, (i + 1) * GROUP_SIZE),
  )
  return {
    recovery_key: recoveryKey,
    groups,
    display: groups.join('-'),
    recovery_auth_key: await hkdf(recoveryKey, 'securepass/v1/recovery-auth'),
    recovery_enc_key: await hkdf(recoveryKey, 'securepass/v1/recovery'),
  }
}

/**
 * Makes a new recovery key and derives its two keys with HKDF.
 * The key is shown as Base32 in groups of 4, for the recovery kit file.
 */
export const newRecoveryKit = (): Promise<RecoveryKit> =>
  kitFromKey(randomBytes(RECOVERY_KEY_LENGTH))

/**
 * Reads a recovery key the way a person types it from the kit: any case, with or without dashes
 * and spaces. Returns the same keys {@link newRecoveryKit} derived when the kit was made.
 * @param text - The recovery key as shown in the kit file.
 */
export const parseRecoveryKey = async (text: string): Promise<Result<RecoveryKit, CryptoError>> => {
  const cleaned = text.toUpperCase().replaceAll(/[\s-]/g, '')
  const bytes = cleaned.length === RECOVERY_KEY_CHARS ? fromBase32(cleaned) : null
  if (!bytes || bytes.length !== RECOVERY_KEY_LENGTH) {
    return err(cryptoError('InvalidInput', 'Recovery key must be 52 Base32 characters'))
  }
  // A typo in the last character can still decode; the canonical text must match what was typed.
  if (toBase32(bytes) !== cleaned) {
    return err(cryptoError('InvalidInput', 'Recovery key is not valid'))
  }
  return ok(await kitFromKey(bytes))
}

/**
 * Opens the vault key wrapped for recovery. The same vault key the password path unwraps.
 * @param recoveryEncKey - `recovery_enc_key` from the kit.
 * @param wrapped - `wrapped_vault_key_recovery` from the server, base64url.
 * @param accountId - The account the kit belongs to.
 */
export const unwrapVaultKeyRecovery = (
  recoveryEncKey: Uint8Array,
  wrapped: string,
  accountId: string,
): Result<Uint8Array, CryptoError> => {
  const bytes = fromBase64Url(wrapped)
  if (!bytes) return err(cryptoError('Damaged', 'Wrapped vault key is not valid base64url'))
  const opened = open(recoveryEncKey, bytes, `vault-key-recovery|${accountId}`)
  if (!opened.ok) return opened
  return opened.value.length === 32
    ? ok(opened.value)
    : err(cryptoError('Damaged', 'Vault key has the wrong length'))
}
