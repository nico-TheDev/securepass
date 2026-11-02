import { randomBytes, utf8 } from './bytes'

/** Makes a UUID v4 for a new account. The client makes it and sends it in `/api/setup`. */
export const newAccountId = (): string => crypto.randomUUID()

/** Makes the 32 random bytes of a new vault key. */
export const newVaultKey = (): Uint8Array => randomBytes(32)

/**
 * HKDF SHA-256 with no salt (RFC 5869) over a 32 byte key.
 * @param key - Input key material.
 * @param info - Context string that separates the outputs.
 */
export const hkdf = async (key: Uint8Array, info: string): Promise<Uint8Array> => {
  const material = await crypto.subtle.importKey('raw', new Uint8Array(key), 'HKDF', false, [
    'deriveBits',
  ])
  const bits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt: new Uint8Array(0), info: new Uint8Array(utf8(info)) },
    material,
    256,
  )
  return new Uint8Array(bits)
}

/**
 * Splits the master key into two unrelated keys. `enc_key` never leaves the device;
 * `auth_key` is the login proof sent to the server and can never decrypt anything.
 * @param masterKey - The Argon2id output.
 */
export const splitKeys = async (
  masterKey: Uint8Array,
): Promise<{ readonly enc_key: Uint8Array; readonly auth_key: Uint8Array }> => ({
  enc_key: await hkdf(masterKey, 'securepass/v1/enc'),
  auth_key: await hkdf(masterKey, 'securepass/v1/auth'),
})
