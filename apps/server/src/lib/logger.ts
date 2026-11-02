const REDACTED_KEYS = new Set([
  'auth_key',
  'recovery_auth_key',
  'token',
  'recovery_token',
  'ciphertext',
  'totp_code',
  'recovery_code',
  'wrapped_vault_key',
  'wrapped_vault_key_recovery',
  'authorization',
  'x-setup-token',
])

/**
 * Copies a value with every secret field replaced by `[redacted]`, at any depth.
 * @param value - Anything that may hold request fields.
 */
export const redact = (value: unknown): unknown => {
  if (Array.isArray(value)) return value.map(redact)
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(inner),
      ]),
    )
  }
  return value
}

/**
 * Writes one structured JSON log line. Fields pass through {@link redact}.
 * Request bodies and tokens are never passed in; the redaction is a second line of defence.
 * @param level - Log level.
 * @param message - Short event name.
 * @param fields - Extra fields, redacted before writing.
 */
export const log = (
  level: 'info' | 'warn' | 'error',
  message: string,
  fields: Record<string, unknown> = {},
): void => {
  console[level](JSON.stringify({ level, message, ...(redact(fields) as object) }))
}
