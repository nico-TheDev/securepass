import { fromBase64Url } from '@securepass/crypto'
import { err, ok, type Result } from '@securepass/shared'
import { z } from 'zod'

const keySchema = z
  .string()
  .refine((text) => fromBase64Url(text)?.length === 32, 'must be 32 random bytes in base64url')

const envSchema = z.object({
  SETUP_TOKEN: z.string().min(16),
  AUTH_HMAC_KEY: keySchema,
  CODE_HMAC_KEY: keySchema,
  IP_HASH_KEY: keySchema,
  PRELOGIN_KEY: keySchema,
  TOTP_ENC_KEY: keySchema,
  ALLOWED_ORIGINS: z.string().default(''),
})

/** Validated settings, with each key already decoded to bytes. Each key has one purpose. */
export type Config = {
  readonly setupToken: string
  /** HMAC key for `auth_key` and `recovery_auth_key`. */
  readonly authHmacKey: Uint8Array
  /** HMAC key for recovery codes. */
  readonly codeHmacKey: Uint8Array
  /** HMAC key for IP addresses, so raw IPs are never stored. */
  readonly ipHashKey: Uint8Array
  /** HMAC key for the fake salt prelogin returns for an unknown email. */
  readonly preloginKey: Uint8Array
  /** AES-256-GCM key for the TOTP secret at rest. */
  readonly totpEncKey: Uint8Array
  readonly allowedOrigins: readonly string[]
}

/**
 * Checks the Worker bindings and secrets. Missing or malformed values are a deploy mistake,
 * so the caller answers 500 on every request until they are fixed.
 * @param env - The Worker bindings.
 */
export const parseConfig = (env: unknown): Result<Config, string> => {
  const parsed = envSchema.safeParse(env)
  if (!parsed.success) {
    const names = [...new Set(parsed.error.issues.map((issue) => String(issue.path[0])))]
    return err(`Invalid configuration: ${names.join(', ')}`)
  }
  const decode = (text: string): Uint8Array => fromBase64Url(text) ?? new Uint8Array()
  return ok({
    setupToken: parsed.data.SETUP_TOKEN,
    authHmacKey: decode(parsed.data.AUTH_HMAC_KEY),
    codeHmacKey: decode(parsed.data.CODE_HMAC_KEY),
    ipHashKey: decode(parsed.data.IP_HASH_KEY),
    preloginKey: decode(parsed.data.PRELOGIN_KEY),
    totpEncKey: decode(parsed.data.TOTP_ENC_KEY),
    allowedOrigins: parsed.data.ALLOWED_ORIGINS.split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  })
}
