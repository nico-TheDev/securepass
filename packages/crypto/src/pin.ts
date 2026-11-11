import { err, type KdfParams, ok, type Result } from '@securepass/shared'
import { fromBase64Url, randomBytes, toBase64Url } from './bytes'
import { open, seal } from './envelope'
import { type CryptoError, cryptoError } from './errors'
import { deriveMasterKey, KDF_FLOOR } from './kdf'

/** Shortest PIN allowed. Letters count; the limit is on characters. */
export const PIN_MIN_LENGTH = 6

const PIN_KDF: KdfParams = { alg: 'argon2id', ...KDF_FLOOR }

/** A vault key sealed under a PIN, plus the salt the PIN was stretched with. Memory only (see 0004). */
export type PinWrap = {
  readonly pin_wrapped_vault_key: string
  readonly pin_salt: string
}

const pinTooShort = (pin: string): boolean => [...pin.normalize('NFC')].length < PIN_MIN_LENGTH

const derivePinKey = (pin: string, salt: Uint8Array): Promise<Result<Uint8Array, CryptoError>> =>
  deriveMasterKey({ password: pin, kdf: PIN_KDF, kdfSalt: salt })

/**
 * Seals the vault key under a key stretched from the PIN with Argon2id at the floor settings.
 * The envelope is bound to this device id, so it opens nowhere else.
 * Runs Argon2id, so call it from a page context, never the service worker.
 * @param pin - At least 6 characters.
 * @param vaultKey - The unlocked 32 byte vault key.
 * @param deviceId - The extension's device id.
 */
export const wrapWithPin = async (
  pin: string,
  vaultKey: Uint8Array,
  deviceId: string,
): Promise<Result<PinWrap, CryptoError>> => {
  if (pinTooShort(pin)) {
    return err(cryptoError('InvalidInput', 'PIN must be at least 6 characters'))
  }
  const salt = randomBytes(16)
  const pinKey = await derivePinKey(pin, salt)
  if (!pinKey.ok) return pinKey
  const sealed = seal(pinKey.value, vaultKey, `pin|${deviceId}`)
  pinKey.value.fill(0)
  return ok({ pin_wrapped_vault_key: toBase64Url(sealed), pin_salt: toBase64Url(salt) })
}

/**
 * Opens a PIN wrapped vault key. A wrong PIN, another device id, or a changed byte is `Damaged`.
 * @param pin - The PIN as typed.
 * @param wrap - What {@link wrapWithPin} returned.
 * @param deviceId - The extension's device id.
 */
export const unwrapWithPin = async (
  pin: string,
  wrap: PinWrap,
  deviceId: string,
): Promise<Result<Uint8Array, CryptoError>> => {
  const salt = fromBase64Url(wrap.pin_salt)
  const sealed = fromBase64Url(wrap.pin_wrapped_vault_key)
  if (!salt || !sealed) return err(cryptoError('Damaged', 'PIN wrap is not valid base64url'))
  if (pinTooShort(pin)) return err(cryptoError('Damaged', 'PIN did not open the vault key'))
  const pinKey = await derivePinKey(pin, salt)
  if (!pinKey.ok) return pinKey
  const opened = open(pinKey.value, sealed, `pin|${deviceId}`)
  pinKey.value.fill(0)
  if (!opened.ok) return opened
  return opened.value.length === 32
    ? ok(opened.value)
    : err(cryptoError('Damaged', 'Vault key has the wrong length'))
}
