import { assertKdf, fromBase64Url, KDF_FLOOR, toBase64Url } from '@securepass/crypto'
import {
  type KdfParams,
  kdfParamsSchema,
  loginRequestSchema,
  preloginRequestSchema,
  setupRequestSchema,
} from '@securepass/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { createDb } from '../db/client'
import { account } from '../db/schema'
import { parseBody } from '../lib/body'
import { hmacSha256, newDeviceToken, secretsMatch, timingSafeEqual } from '../lib/hmac'
import { errorJson, nowSeconds, unauthorized } from '../lib/http'
import { SESSION_TTL_SECONDS } from '../middleware/bearer'

const AUTH_KEY_LENGTH = 32
const KDF_SALT_LENGTH = 16

/** An `ArrayBuffer` copy of the bytes, the form D1 accepts for a blob. */
const blobOf = (bytes: Uint8Array): ArrayBuffer => bytes.slice().buffer

/** Decodes base64url and checks the length (`undefined` length means any non empty value). */
const decode = (text: string, length?: number): Uint8Array | null => {
  const bytes = fromBase64Url(text)
  if (!bytes || bytes.length === 0) return null
  return length === undefined || bytes.length === length ? bytes : null
}

/** Setup, prelogin, and login. */
export const authRoutes = new Hono<AppEnv>()

authRoutes.post('/setup', async (c) => {
  const { config } = c.var
  const given = c.req.header('X-Setup-Token') ?? ''
  if (!(await secretsMatch(given, config.setupToken))) return unauthorized(c, 'invalid')

  const body = await parseBody(c, setupRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)
  const req = body.value

  const kdf = assertKdf(req.kdf)
  if (!kdf.ok) return errorJson(c, 422, 'kdf_out_of_range', { reason: kdf.error.kind })

  const kdfSalt = decode(req.kdf_salt, KDF_SALT_LENGTH)
  const authKey = decode(req.auth_key, AUTH_KEY_LENGTH)
  const recoveryAuthKey = decode(req.recovery_auth_key, AUTH_KEY_LENGTH)
  const wrappedVaultKey = decode(req.wrapped_vault_key)
  const wrappedRecovery = decode(req.wrapped_vault_key_recovery)
  if (!kdfSalt || !authKey || !recoveryAuthKey || !wrappedVaultKey || !wrappedRecovery) {
    return errorJson(c, 400, 'invalid_request')
  }

  const db = createDb(c.env.DB)
  const existing = await db.select({ id: account.id }).from(account).limit(1).get()
  if (existing) return errorJson(c, 409, 'account_exists')

  const now = nowSeconds()
  const { token, tokenHash } = await newDeviceToken()
  const [authKeyHmac, recoveryAuthHmac] = await Promise.all([
    hmacSha256(config.authHmacKey, authKey),
    hmacSha256(config.authHmacKey, recoveryAuthKey),
  ])

  // One D1 batch is one transaction. The account insert only runs while the table is empty,
  // and the session insert only runs if the account insert wrote a row, so a second setup
  // racing this one cannot leave a stray session behind.
  const results = await c.env.DB.batch([
    c.env.DB.prepare(
      `INSERT INTO account (id, email, kdf, kdf_salt, auth_key_hmac, recovery_auth_hmac,
         wrapped_vault_key, wrapped_vault_key_recovery, totp_enabled, recovery_code_hmacs,
         revision, created_at)
       SELECT ?, ?, ?, ?, ?, ?, ?, ?, 0, '[]', 0, ?
       WHERE NOT EXISTS (SELECT 1 FROM account)`,
    ).bind(
      req.account_id,
      req.email,
      JSON.stringify(kdf.value),
      blobOf(kdfSalt),
      blobOf(authKeyHmac),
      blobOf(recoveryAuthHmac),
      blobOf(wrappedVaultKey),
      blobOf(wrappedRecovery),
      now,
    ),
    c.env.DB.prepare(
      `INSERT INTO device_session (id, account_id, device_name, token_hash, created_at,
         last_seen_at, expires_at)
       SELECT ?, ?, ?, ?, ?, ?, ? WHERE changes() > 0`,
    ).bind(
      crypto.randomUUID(),
      req.account_id,
      req.device_name,
      blobOf(tokenHash),
      now,
      now,
      now + SESSION_TTL_SECONDS,
    ),
  ])
  if ((results[0]?.meta.changes ?? 0) === 0) return errorJson(c, 409, 'account_exists')

  return c.json({ token }, 201)
})

authRoutes.post('/auth/prelogin', async (c) => {
  const body = await parseBody(c, preloginRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)
  const { email } = body.value

  const db = createDb(c.env.DB)
  const row = await db
    .select({ kdf: account.kdf, kdfSalt: account.kdfSalt })
    .from(account)
    .where(eq(account.email, email))
    .get()
  if (row) {
    const kdf = kdfParamsSchema.safeParse(JSON.parse(row.kdf))
    if (kdf.success) return c.json({ kdf: kdf.data, kdf_salt: toBase64Url(row.kdfSalt) })
  }

  // Unknown email: answer with a stable fake salt so the reply does not reveal whether it exists.
  const fakeSalt = (await hmacSha256(c.var.config.preloginKey, email)).slice(0, KDF_SALT_LENGTH)
  const floor: KdfParams = { alg: 'argon2id', ...KDF_FLOOR }
  return c.json({ kdf: floor, kdf_salt: toBase64Url(fakeSalt) })
})

authRoutes.post('/auth/login', async (c) => {
  const { config } = c.var
  const body = await parseBody(c, loginRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)
  const req = body.value

  const authKey = decode(req.auth_key, AUTH_KEY_LENGTH)
  if (!authKey) return unauthorized(c, 'invalid')

  const db = createDb(c.env.DB)
  const row = await db.select().from(account).where(eq(account.email, req.email)).get()

  // Always compute and compare a proof, so an unknown email costs the same as a wrong key.
  const proof = await hmacSha256(config.authHmacKey, authKey)
  const stored = row?.authKeyHmac ?? new Uint8Array(proof.length)
  const keyMatches = timingSafeEqual(proof, stored)
  if (!row || !keyMatches) return unauthorized(c, 'invalid')

  // TOTP is skipped only while it is not enabled. Checking a code is a later build task, so a
  // vault with TOTP on fails closed here instead of letting the password alone through.
  if (row.totpEnabled !== 0) return unauthorized(c, 'invalid')

  const now = nowSeconds()
  const { token, tokenHash } = await newDeviceToken()
  await c.env.DB.prepare(
    `INSERT INTO device_session (id, account_id, device_name, token_hash, created_at,
       last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      crypto.randomUUID(),
      row.id,
      req.device_name,
      blobOf(tokenHash),
      now,
      now,
      now + SESSION_TTL_SECONDS,
    )
    .run()

  return c.json({
    token,
    account_id: row.id,
    wrapped_vault_key: toBase64Url(row.wrappedVaultKey),
    revision: row.revision,
  })
})
