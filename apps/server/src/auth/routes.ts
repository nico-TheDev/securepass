import { assertKdf, KDF_FLOOR, toBase64Url } from '@securepass/crypto'
import {
  type KdfParams,
  kdfParamsSchema,
  type LoginResponse,
  loginRequestSchema,
  preloginRequestSchema,
  type RecoverResponse,
  recoverRequestSchema,
  setupRequestSchema,
} from '@securepass/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { createDb } from '../db/client'
import { account } from '../db/schema'
import { parseBody } from '../lib/body'
import { blobOf, randomBytes } from '../lib/bytes'
import { hmacSha256, newDeviceToken, secretsMatch, sha256, timingSafeEqual } from '../lib/hmac'
import { errorJson, nowSeconds, unauthorized } from '../lib/http'
import { SESSION_TTL_SECONDS } from '../middleware/bearer'
import { AUTH_KEY_LENGTH, decode, KDF_SALT_LENGTH } from './decode'
import { enterLimiter, recordFailure, recordSuccess, slowIfAccountUnderAttack } from './limiter'
import { checkSecondFactor, consumeSecondFactor } from './second-factor'

/** A recovery token is good for 10 minutes. */
const RECOVERY_TOKEN_TTL_SECONDS = 10 * 60

/** Setup, prelogin, login, and recover. None of these need a session. */
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

  // Prelogin shares the per IP gate, so a blocked IP cannot keep probing emails.
  const gate = await enterLimiter(c, 'login')
  if ('blocked' in gate) return gate.blocked

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

  // Unknown email: it counts toward the per IP limit, and the answer is a stable fake salt so the
  // reply does not reveal whether the email exists.
  await recordFailure(c, gate.pass, null)
  const fakeSalt = (await hmacSha256(c.var.config.preloginKey, email)).slice(0, KDF_SALT_LENGTH)
  const floor: KdfParams = { alg: 'argon2id', ...KDF_FLOOR }
  return c.json({ kdf: floor, kdf_salt: toBase64Url(fakeSalt) })
})

authRoutes.post('/auth/login', async (c) => {
  const { config } = c.var
  const body = await parseBody(c, loginRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)
  const req = body.value

  const gate = await enterLimiter(c, 'login')
  if ('blocked' in gate) return gate.blocked

  const db = createDb(c.env.DB)
  const row = await db.select().from(account).where(eq(account.email, req.email)).get()
  if (row) await slowIfAccountUnderAttack(c, row.id)

  // Always compute and compare a proof, so an unknown email costs the same as a wrong key.
  const authKey = decode(req.auth_key, AUTH_KEY_LENGTH) ?? new Uint8Array(AUTH_KEY_LENGTH)
  const proof = await hmacSha256(config.authHmacKey, authKey)
  const stored = row?.authKeyHmac ?? new Uint8Array(proof.length)
  const keyMatches = timingSafeEqual(proof, stored)

  // Both credentials are checked together and fail with one answer. The second proof is only
  // used up once the auth key is known to be right.
  const factor = row ? await checkSecondFactor(c, row, req, true) : null
  if (!row || !keyMatches || !factor || !(await consumeSecondFactor(c, row.id, factor))) {
    await recordFailure(c, gate.pass, row?.id ?? null)
    return unauthorized(c, 'invalid')
  }
  await recordSuccess(c, gate.pass, row.id)

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

  const response: LoginResponse = {
    token,
    account_id: row.id,
    wrapped_vault_key: toBase64Url(row.wrappedVaultKey),
    revision: row.revision,
  }
  return c.json(response)
})

authRoutes.post('/auth/recover', async (c) => {
  const { config } = c.var
  const body = await parseBody(c, recoverRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)
  const req = body.value

  const gate = await enterLimiter(c, 'recover')
  if ('blocked' in gate) return gate.blocked

  const db = createDb(c.env.DB)
  const row = await db.select().from(account).where(eq(account.email, req.email)).get()
  if (row) await slowIfAccountUnderAttack(c, row.id)

  const recoveryAuthKey =
    decode(req.recovery_auth_key, AUTH_KEY_LENGTH) ?? new Uint8Array(AUTH_KEY_LENGTH)
  const proof = await hmacSha256(config.authHmacKey, recoveryAuthKey)
  const keyMatches = timingSafeEqual(proof, row?.recoveryAuthHmac ?? new Uint8Array(proof.length))

  const factor = row ? await checkSecondFactor(c, row, req, true) : null
  if (!row || !keyMatches || !factor || !(await consumeSecondFactor(c, row.id, factor))) {
    await recordFailure(c, gate.pass, row?.id ?? null)
    return unauthorized(c, 'invalid')
  }
  await recordSuccess(c, gate.pass, row.id)

  // 32 random bytes, returned once and stored only as SHA-256, for one password change.
  const rawToken = randomBytes(32)
  await c.env.DB.prepare(
    'UPDATE account SET recovery_token_hash = ?, recovery_token_expires_at = ? WHERE id = ?',
  )
    .bind(blobOf(await sha256(rawToken)), nowSeconds() + RECOVERY_TOKEN_TTL_SECONDS, row.id)
    .run()

  const response: RecoverResponse = {
    recovery_token: toBase64Url(rawToken),
    wrapped_vault_key_recovery: toBase64Url(row.wrappedVaultKeyRecovery),
    account_id: row.id,
  }
  return c.json(response)
})
