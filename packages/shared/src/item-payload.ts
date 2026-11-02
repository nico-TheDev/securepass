import { z } from 'zod'

const loginUrlSchema = z.object({
  url: z.string(),
  match: z.enum(['domain', 'host']).default('domain'),
})

const loginSchema = z.object({
  username: z.string(),
  password: z.string(),
  urls: z.array(loginUrlSchema),
  totp_secret: z.string().nullable(),
})

const identitySchema = z.object({
  title: z.string().nullable(),
  first: z.string().nullable(),
  last: z.string().nullable(),
  email: z.string().nullable(),
  phone: z.string().nullable(),
  address1: z.string().nullable(),
  address2: z.string().nullable(),
  city: z.string().nullable(),
  region: z.string().nullable(),
  postal: z.string().nullable(),
  country: z.string().nullable(),
})

const passwordHistoryEntrySchema = z.object({
  password: z.string(),
  replaced_at: z.iso.datetime({ offset: true }),
})

/** Every field of a payload except `conflict_copies`, so a kept copy cannot nest further copies. */
const baseItemPayloadSchema = z.object({
  v: z.literal(1),
  seq: z.number().int().min(1),
  type: z.enum(['login', 'note', 'identity']),
  name: z.string().min(1).max(256),
  folder: z.string().nullable(),
  favorite: z.boolean(),
  trashed: z.boolean(),
  edited_at: z.iso.datetime({ offset: true }),
  edited_by: z.string(),
  login: loginSchema.optional(),
  password_history: z.array(passwordHistoryEntrySchema).max(5).optional(),
  note: z.string(),
  identity: identitySchema.optional(),
})

/** The plaintext inside an item ciphertext. Versioned by `v`. Never sent to the server as is. */
export const itemPayloadSchema = baseItemPayloadSchema.extend({
  conflict_copies: z
    .array(z.object({ payload: baseItemPayloadSchema, kept_at: z.iso.datetime({ offset: true }) }))
    .max(5)
    .optional(),
})

export type ItemPayload = z.infer<typeof itemPayloadSchema>
