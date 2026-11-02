import { toBase64Url } from '@securepass/crypto'

const encoder = new TextEncoder()

const randomBytes = (length: number): Uint8Array => crypto.getRandomValues(new Uint8Array(length))

const importHmacKey = (key: Uint8Array): Promise<CryptoKey> =>
  crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])

/**
 * HMAC-SHA256 of `data` under `key`.
 * @param key - A 32 byte secret that serves one purpose only.
 * @param data - The bytes or text to authenticate.
 */
export const hmacSha256 = async (
  key: Uint8Array,
  data: Uint8Array | string,
): Promise<Uint8Array> => {
  const bytes = typeof data === 'string' ? encoder.encode(data) : data
  const signature = await crypto.subtle.sign('HMAC', await importHmacKey(key), bytes)
  return new Uint8Array(signature)
}

/**
 * SHA-256 of `data`. Used to store device tokens so a database leak cannot replay them.
 * @param data - The bytes to hash.
 */
export const sha256 = async (data: Uint8Array): Promise<Uint8Array> =>
  new Uint8Array(await crypto.subtle.digest('SHA-256', data))

/**
 * Compares two byte arrays without stopping at the first difference.
 * Arrays of different length are never equal; the length is not secret here.
 * @param a - First value.
 * @param b - Second value.
 */
export const timingSafeEqual = (a: Uint8Array, b: Uint8Array): boolean => {
  if (a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0)
  return diff === 0
}

/**
 * Compares two secret strings in constant time by comparing their HMACs under a fresh key.
 * Hiding the length of the expected value too.
 * @param a - First value.
 * @param b - Second value.
 */
export const secretsMatch = async (a: string, b: string): Promise<boolean> => {
  const key = randomBytes(32)
  const [left, right] = await Promise.all([hmacSha256(key, a), hmacSha256(key, b)])
  return timingSafeEqual(left, right)
}

/** Makes a new device token: 32 random bytes as base64url, plus the SHA-256 the server keeps. */
export const newDeviceToken = async (): Promise<{ token: string; tokenHash: Uint8Array }> => {
  const raw = randomBytes(32)
  return { token: toBase64Url(raw), tokenHash: await sha256(raw) }
}
