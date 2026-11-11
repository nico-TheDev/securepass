import { z } from 'zod'
import { kdfParamsSchema } from './kdf'

/** Unpadded base64url text. Every binary field in the API travels in this form. */
export const base64UrlSchema = z.string().regex(/^[A-Za-z0-9_-]+$/)

const emailSchema = z.string().trim().toLowerCase().pipe(z.email().max(254))

const deviceNameSchema = z.string().trim().min(1).max(100)

/** Body of `POST /api/setup`. Only proofs, ciphertext, KDF settings, and ids: never key material. */
export const setupRequestSchema = z.object({
  account_id: z.uuid(),
  email: emailSchema,
  kdf: kdfParamsSchema,
  kdf_salt: base64UrlSchema,
  auth_key: base64UrlSchema,
  recovery_auth_key: base64UrlSchema,
  wrapped_vault_key: base64UrlSchema,
  wrapped_vault_key_recovery: base64UrlSchema,
  device_name: deviceNameSchema,
})
export type SetupRequest = z.infer<typeof setupRequestSchema>

/** Body of `POST /api/auth/prelogin`. */
export const preloginRequestSchema = z.object({ email: emailSchema })
export type PreloginRequest = z.infer<typeof preloginRequestSchema>

/** Body of `POST /api/auth/login`. */
export const loginRequestSchema = z.object({
  email: emailSchema,
  auth_key: base64UrlSchema,
  totp_code: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
  recovery_code: z.string().min(1).max(32).optional(),
  device_name: deviceNameSchema,
})
export type LoginRequest = z.infer<typeof loginRequestSchema>

/** Body of `PUT /api/items/:id`. The base revision travels in the `If-Match` header. */
export const putItemRequestSchema = z.object({
  ciphertext: base64UrlSchema,
  trashed: z.boolean(),
})
export type PutItemRequest = z.infer<typeof putItemRequestSchema>

/** The reason a request was answered 401. Clients wipe local data only on `revoked`. */
export const unauthorizedCodeSchema = z.enum(['invalid', 'expired', 'revoked'])
export type UnauthorizedCode = z.infer<typeof unauthorizedCodeSchema>

/** One item as `GET /api/sync` and a 409 conflict report it. `ciphertext` is null once purged. */
export const syncItemSchema = z.object({
  id: z.string(),
  revision: z.number().int(),
  ciphertext: base64UrlSchema.nullable(),
  created_at: z.number().int(),
  updated_at: z.number().int(),
  deleted_at: z.number().int().nullable(),
  purged: z.boolean(),
})
export type SyncItem = z.infer<typeof syncItemSchema>

/** Response of `GET /api/sync`. */
export const syncResponseSchema = z.object({
  items: z.array(syncItemSchema),
  revision: z.number().int(),
  full_resync: z.boolean(),
})
export type SyncResponse = z.infer<typeof syncResponseSchema>

/** Response of `POST /api/setup`. */
export const setupResponseSchema = z.object({ token: base64UrlSchema })
export type SetupResponse = z.infer<typeof setupResponseSchema>

/** Response of `POST /api/auth/prelogin`. */
export const preloginResponseSchema = z.object({ kdf: kdfParamsSchema, kdf_salt: base64UrlSchema })
export type PreloginResponse = z.infer<typeof preloginResponseSchema>

/** Response of `POST /api/auth/login`. */
export const loginResponseSchema = z.object({
  token: base64UrlSchema,
  account_id: z.uuid(),
  wrapped_vault_key: base64UrlSchema,
  revision: z.number().int(),
})
export type LoginResponse = z.infer<typeof loginResponseSchema>

const totpCodeSchema = z.string().regex(/^\d{6}$/)
const recoveryCodeSchema = z.string().min(1).max(32)

/** Body of `POST /api/auth/recover`: the recovery proof plus a second proof. */
export const recoverRequestSchema = z.object({
  email: emailSchema,
  recovery_auth_key: base64UrlSchema,
  totp_code: totpCodeSchema.optional(),
  recovery_code: recoveryCodeSchema.optional(),
})
export type RecoverRequest = z.infer<typeof recoverRequestSchema>

/** Response of `POST /api/auth/recover`. The token is single use and lasts 10 minutes. */
export const recoverResponseSchema = z.object({
  recovery_token: base64UrlSchema,
  wrapped_vault_key_recovery: base64UrlSchema,
  account_id: z.uuid(),
})
export type RecoverResponse = z.infer<typeof recoverResponseSchema>

/** Response of `POST /api/account/totp`. Both values are shown once. */
export const totpEnrollResponseSchema = z.object({
  otpauth_uri: z.string(),
  recovery_codes: z.array(z.string()).length(10),
})
export type TotpEnrollResponse = z.infer<typeof totpEnrollResponseSchema>

/** A body that carries only a fresh TOTP code. Used by confirm and by every sensitive action. */
export const totpCodeRequestSchema = z.object({ totp_code: totpCodeSchema })
export type TotpCodeRequest = z.infer<typeof totpCodeRequestSchema>

/** A fresh TOTP code that may be left out only while TOTP is not enabled yet. */
export const freshTotpRequestSchema = z.object({ totp_code: totpCodeSchema.optional() })
export type FreshTotpRequest = z.infer<typeof freshTotpRequestSchema>

const newPasswordFields = {
  kdf: kdfParamsSchema,
  kdf_salt: base64UrlSchema,
  auth_key: base64UrlSchema,
  wrapped_vault_key: base64UrlSchema,
}

/**
 * Body of `POST /api/account/password`. Either the current auth key plus a fresh TOTP code
 * (a signed in password change), or a recovery token plus a brand new recovery kit.
 */
export const passwordRequestSchema = z.union([
  z.object({
    ...newPasswordFields,
    current_auth_key: base64UrlSchema,
    totp_code: totpCodeSchema.optional(),
  }),
  z.object({
    ...newPasswordFields,
    recovery_token: base64UrlSchema,
    recovery_auth_key: base64UrlSchema,
    wrapped_vault_key_recovery: base64UrlSchema,
    device_name: deviceNameSchema,
  }),
])
export type PasswordRequest = z.infer<typeof passwordRequestSchema>

/** Response of `POST /api/account/password`. Recovery also returns 10 new recovery codes. */
export const passwordResponseSchema = z.object({
  token: base64UrlSchema,
  recovery_codes: z.array(z.string()).length(10).optional(),
})
export type PasswordResponse = z.infer<typeof passwordResponseSchema>

/** Response of `PUT /api/items/:id`. */
export const putItemResponseSchema = z.object({
  revision: z.number().int(),
  updated_at: z.number().int(),
  purge_after: z.number().int().nullable(),
})
export type PutItemResponse = z.infer<typeof putItemResponseSchema>

/** The body of a 409 from an item write: the row the server holds now, or null if it has none. */
export const conflictResponseSchema = z.object({ current: syncItemSchema.nullable() })
export type ConflictResponse = z.infer<typeof conflictResponseSchema>

/** One signed in device, as `GET /api/devices` lists it. */
export const deviceSchema = z.object({
  id: z.string(),
  name: z.string(),
  created_at: z.number().int(),
  last_seen_at: z.number().int(),
  current: z.boolean(),
})
export type Device = z.infer<typeof deviceSchema>

/** Response of `GET /api/devices`. */
export const devicesResponseSchema = z.object({ devices: z.array(deviceSchema) })
export type DevicesResponse = z.infer<typeof devicesResponseSchema>
