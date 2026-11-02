import { xchacha20poly1305 } from '@noble/ciphers/chacha.js'
import { err, ok, type Result } from '@securepass/shared'
import { concat, randomBytes, utf8 } from './bytes'
import { type CryptoError, cryptoError } from './errors'

const VERSION = 0x01
const NONCE_LENGTH = 24
const TAG_LENGTH = 16
const KEY_LENGTH = 32

/** The only associated data types. Each envelope kind binds to its own prefix. */
export type EnvelopeKind = 'vault-key' | 'vault-key-recovery' | 'item-key' | 'item' | 'pin'

const damaged = (): CryptoError => cryptoError('Damaged', 'Ciphertext failed its tamper check')

/** AD bytes: the version byte, then `securepass/v1|<ad>`. The version byte is authenticated too. */
const associatedData = (ad: string): Uint8Array =>
  concat(Uint8Array.of(VERSION), utf8(`securepass/v1|${ad}`))

/**
 * Seals plaintext with XChaCha20-Poly1305 under a fresh random 24 byte nonce.
 * Output is `0x01 | nonce | ciphertext+tag`. The `ad` binds the ciphertext to its purpose and id.
 * @param key - A 32 byte key.
 * @param plaintext - The bytes to protect.
 * @param ad - Associated data, for example `item|<item_id>`. Must match on open.
 */
export const seal = (key: Uint8Array, plaintext: Uint8Array, ad: string): Uint8Array => {
  const nonce = randomBytes(NONCE_LENGTH)
  const ciphertext = xchacha20poly1305(key, nonce, associatedData(ad)).encrypt(plaintext)
  return concat(Uint8Array.of(VERSION), nonce, ciphertext)
}

/**
 * Opens an envelope made by {@link seal}. Any changed byte, wrong key, wrong `ad`, or unknown
 * version byte fails. There is no fallback mode.
 * @param key - The 32 byte key used to seal.
 * @param envelope - The sealed bytes.
 * @param ad - The associated data used to seal.
 */
export const open = (
  key: Uint8Array,
  envelope: Uint8Array,
  ad: string,
): Result<Uint8Array, CryptoError> => {
  if (key.length !== KEY_LENGTH) return err(cryptoError('InvalidInput', 'Key must be 32 bytes'))
  if (envelope.length < 1 + NONCE_LENGTH + TAG_LENGTH || envelope[0] !== VERSION)
    return err(damaged())
  const nonce = envelope.subarray(1, 1 + NONCE_LENGTH)
  const ciphertext = envelope.subarray(1 + NONCE_LENGTH)
  try {
    return ok(xchacha20poly1305(key, nonce, associatedData(ad)).decrypt(ciphertext))
  } catch {
    return err(damaged())
  }
}
