import { fromBase64Url } from '@securepass/crypto'

/** Length in bytes of `auth_key` and `recovery_auth_key`. */
export const AUTH_KEY_LENGTH = 32
/** Length in bytes of `kdf_salt`. */
export const KDF_SALT_LENGTH = 16

/** Decodes base64url and checks the length (`undefined` length means any non empty value). */
export const decode = (text: string, length?: number): Uint8Array | null => {
  const bytes = fromBase64Url(text)
  if (!bytes || bytes.length === 0) return null
  return length === undefined || bytes.length === length ? bytes : null
}
