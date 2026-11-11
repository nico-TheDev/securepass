import { fromBase32, toBase32 } from '@securepass/crypto'
import { randomBytes } from './bytes'
import { timingSafeEqual } from './hmac'

const STEP_SECONDS = 30
const DIGITS = 6
const SECRET_LENGTH = 20
const IV_LENGTH = 12
const encoder = new TextEncoder()

/** Makes the 20 random bytes of a new TOTP secret. */
export const newTotpSecret = (): Uint8Array => randomBytes(SECRET_LENGTH)

/** The time step a moment falls in (RFC 6238, 30 second steps). */
export const totpStep = (nowSeconds: number): number => Math.floor(nowSeconds / STEP_SECONDS)

/**
 * The 6 digit code for one time step (RFC 6238 over RFC 4226, HMAC-SHA-1).
 * @param secret - The shared secret bytes.
 * @param step - The time step number.
 */
export const totpCode = async (secret: Uint8Array, step: number): Promise<string> => {
  const key = await crypto.subtle.importKey('raw', secret, { name: 'HMAC', hash: 'SHA-1' }, false, [
    'sign',
  ])
  const counter = new Uint8Array(8)
  new DataView(counter.buffer).setBigUint64(0, BigInt(step))
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', key, counter))
  const offset = (mac[mac.length - 1] ?? 0) & 0x0f
  const binary =
    (((mac[offset] ?? 0) & 0x7f) << 24) |
    ((mac[offset + 1] ?? 0) << 16) |
    ((mac[offset + 2] ?? 0) << 8) |
    (mac[offset + 3] ?? 0)
  return String(binary % 10 ** DIGITS).padStart(DIGITS, '0')
}

/**
 * Finds the time step a code belongs to, looking at the previous, current, and next step.
 * A step at or below `lastStep` never matches, so a code cannot be used twice.
 * @returns The matching step, or `null`.
 */
export const matchTotpStep = async (
  secret: Uint8Array,
  code: string,
  nowSeconds: number,
  lastStep: number | null,
): Promise<number | null> => {
  const current = totpStep(nowSeconds)
  const given = encoder.encode(code)
  let matched: number | null = null
  for (const step of [current - 1, current, current + 1]) {
    const expected = encoder.encode(await totpCode(secret, step))
    const equal = timingSafeEqual(expected, given)
    if (equal && matched === null && (lastStep === null || step > lastStep)) matched = step
  }
  return matched
}

/** The `otpauth://` link an authenticator app reads from the QR code. */
export const otpauthUri = (secret: Uint8Array, email: string): string => {
  const label = encodeURIComponent(`securepass:${email}`)
  return `otpauth://totp/${label}?secret=${toBase32(secret)}&issuer=securepass&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`
}

const importAesKey = (key: Uint8Array, usage: 'encrypt' | 'decrypt'): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', key, 'AES-GCM', false, [usage])

/**
 * Encrypts the TOTP secret for storage with AES-256-GCM. Output is `iv | ciphertext+tag`.
 * @param key - `TOTP_ENC_KEY`, 32 bytes, used for nothing else.
 */
export const encryptTotpSecret = async (
  key: Uint8Array,
  secret: Uint8Array,
): Promise<Uint8Array> => {
  const iv = randomBytes(IV_LENGTH)
  const sealed = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    await importAesKey(key, 'encrypt'),
    secret,
  )
  const out = new Uint8Array(IV_LENGTH + sealed.byteLength)
  out.set(iv)
  out.set(new Uint8Array(sealed), IV_LENGTH)
  return out
}

/** Opens a stored TOTP secret. Returns `null` when the bytes fail their tag check. */
export const decryptTotpSecret = async (
  key: Uint8Array,
  stored: Uint8Array,
): Promise<Uint8Array | null> => {
  if (stored.length <= IV_LENGTH) return null
  try {
    const opened = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: stored.slice(0, IV_LENGTH) },
      await importAesKey(key, 'decrypt'),
      stored.slice(IV_LENGTH),
    )
    return new Uint8Array(opened)
  } catch {
    return null
  }
}

/** Makes 10 recovery codes of 16 Base32 characters (80 bits) each. */
export const newRecoveryCodes = (): readonly string[] =>
  Array.from({ length: 10 }, () => toBase32(randomBytes(10)))

/** The form a recovery code is hashed in: upper case, with spaces and dashes removed. */
export const normalizeRecoveryCode = (code: string): string =>
  code.toUpperCase().replaceAll(/[\s-]/g, '')

/** Reads the Base32 secret out of an `otpauth://` link. Used by tests and tools. */
export const secretFromOtpauthUri = (uri: string): Uint8Array | null => {
  const secret = new URL(uri).searchParams.get('secret')
  return secret ? fromBase32(secret) : null
}
