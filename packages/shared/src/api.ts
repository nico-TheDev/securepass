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
