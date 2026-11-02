import { randomBytes } from './bytes'
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

/**
 * Makes a new recovery key and derives its two keys with HKDF.
 * The key is shown as Base32 in groups of 4, for the recovery kit file.
 */
export const newRecoveryKit = async (): Promise<RecoveryKit> => {
  const recoveryKey = randomBytes(32)
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
