import { assertKdf } from '@securepass/crypto'
import {
  type PasswordResponse,
  passwordRequestSchema,
  type TotpEnrollResponse,
  totpCodeRequestSchema,
} from '@securepass/shared'
import { eq } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { AUTH_KEY_LENGTH, decode, KDF_SALT_LENGTH } from '../auth/decode'
import {
  enterLimiter,
  recordFailure,
  recordSuccess,
  slowIfAccountUnderAttack,
} from '../auth/limiter'
import { checkSecondFactor, consumeSecondFactor, hashRecoveryCodes } from '../auth/second-factor'
import { createDb } from '../db/client'
import { account } from '../db/schema'
import { parseBody } from '../lib/body'
import { blobOf } from '../lib/bytes'
import { hmacSha256, newDeviceToken, sha256, timingSafeEqual } from '../lib/hmac'
import { errorJson, noContent, nowSeconds, unauthorized } from '../lib/http'
import {
  decryptTotpSecret,
  encryptTotpSecret,
  matchTotpStep,
  newRecoveryCodes,
  newTotpSecret,
  otpauthUri,
} from '../lib/totp'
import { resolveSession, SESSION_TTL_SECONDS } from '../middleware/bearer'

/**
 * `POST /api/account/password`. It takes a bearer session (a signed in password change) or a
 * recovery token (no session), so it sits outside the bearer middleware and checks for itself.
 */
export const passwordRoute = new Hono<AppEnv>()

passwordRoute.post('/account/password', async (c) => {
  const { config } = c.var
  const body = await parseBody(c, passwordRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)
  const req = body.value

  const kdf = assertKdf(req.kdf)
  if (!kdf.ok) return errorJson(c, 422, 'kdf_out_of_range', { reason: kdf.error.kind })
  const kdfSalt = decode(req.kdf_salt, KDF_SALT_LENGTH)
  const authKey = decode(req.auth_key, AUTH_KEY_LENGTH)
  const wrappedVaultKey = decode(req.wrapped_vault_key)
  if (!kdfSalt || !authKey || !wrappedVaultKey) return errorJson(c, 400, 'invalid_request')

  const db = createDb(c.env.DB)
  const now = nowSeconds()
  const authKeyHmac = await hmacSha256(config.authHmacKey, authKey)
  const { token, tokenHash } = await newDeviceToken()

  // Every other session is revoked and this device gets a fresh one, all in one transaction with
  // the credential change. The session insert only runs if the account update wrote a row.
  const sessionStatements = (accountId: string, deviceName: string) => [
    c.env.DB.prepare(
      `UPDATE device_session SET revoked_at = ?1 WHERE account_id = ?2 AND revoked_at IS NULL
         AND EXISTS (SELECT 1 FROM account WHERE id = ?2 AND auth_key_hmac = ?3)`,
    ).bind(now, accountId, blobOf(authKeyHmac)),
    c.env.DB.prepare(
      `INSERT INTO device_session (id, account_id, device_name, token_hash, created_at,
         last_seen_at, expires_at)
       SELECT ?1, ?2, ?3, ?4, ?5, ?5, ?6
       WHERE EXISTS (SELECT 1 FROM account WHERE id = ?2 AND auth_key_hmac = ?7)`,
    ).bind(
      crypto.randomUUID(),
      accountId,
      deviceName,
      blobOf(tokenHash),
      now,
      now + SESSION_TTL_SECONDS,
      blobOf(authKeyHmac),
    ),
  ]

  if ('recovery_token' in req) {
    const rawToken = decode(req.recovery_token, 32)
    const recoveryAuthKey = decode(req.recovery_auth_key, AUTH_KEY_LENGTH)
    const wrappedRecovery = decode(req.wrapped_vault_key_recovery)
    if (!recoveryAuthKey || !wrappedRecovery) return errorJson(c, 400, 'invalid_request')
    if (!rawToken) return unauthorized(c, 'invalid')

    const tokenHashGiven = await sha256(rawToken)
    const row = await db
      .select({ id: account.id })
      .from(account)
      .where(eq(account.recoveryTokenHash, tokenHashGiven))
      .get()
    if (!row) return unauthorized(c, 'invalid')

    const recoveryCodes = newRecoveryCodes()
    const [recoveryAuthHmac, codeHmacs] = await Promise.all([
      hmacSha256(config.authHmacKey, recoveryAuthKey),
      hashRecoveryCodes(config.codeHmacKey, recoveryCodes),
    ])
    // The token is single use: the update only matches while the unexpired token is still stored.
    const [updated] = await c.env.DB.batch([
      c.env.DB.prepare(
        `UPDATE account SET kdf = ?1, kdf_salt = ?2, auth_key_hmac = ?3, wrapped_vault_key = ?4,
           recovery_auth_hmac = ?5, wrapped_vault_key_recovery = ?6, recovery_code_hmacs = ?7,
           recovery_token_hash = NULL, recovery_token_expires_at = NULL
         WHERE id = ?8 AND recovery_token_hash = ?9 AND recovery_token_expires_at > ?10`,
      ).bind(
        JSON.stringify(kdf.value),
        blobOf(kdfSalt),
        blobOf(authKeyHmac),
        blobOf(wrappedVaultKey),
        blobOf(recoveryAuthHmac),
        blobOf(wrappedRecovery),
        codeHmacs,
        row.id,
        blobOf(tokenHashGiven),
        now,
      ),
      ...sessionStatements(row.id, req.device_name),
    ])
    if ((updated?.meta.changes ?? 0) === 0) return unauthorized(c, 'invalid')
    const response: PasswordResponse = { token, recovery_codes: [...recoveryCodes] }
    return c.json(response)
  }

  const session = await resolveSession(c)
  if (!session.ok) return unauthorized(c, session.error)
  const row = await db.select().from(account).where(eq(account.id, session.value.accountId)).get()
  if (!row) return unauthorized(c, 'invalid')

  const gate = await enterLimiter(c, 'login')
  if ('blocked' in gate) return gate.blocked
  await slowIfAccountUnderAttack(c, row.id)

  const currentAuthKey =
    decode(req.current_auth_key, AUTH_KEY_LENGTH) ?? new Uint8Array(AUTH_KEY_LENGTH)
  const proof = await hmacSha256(config.authHmacKey, currentAuthKey)
  const keyMatches = timingSafeEqual(proof, row.authKeyHmac)
  const factor = await checkSecondFactor(c, row, req, false)
  if (!keyMatches || !factor || !(await consumeSecondFactor(c, row.id, factor))) {
    await recordFailure(c, gate.pass, row.id)
    return unauthorized(c, 'invalid')
  }
  await recordSuccess(c, gate.pass, row.id)

  const deviceName = await c.env.DB.prepare('SELECT device_name FROM device_session WHERE id = ?')
    .bind(session.value.sessionId)
    .first<{ device_name: string }>()
  const [updated] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE account SET kdf = ?1, kdf_salt = ?2, auth_key_hmac = ?3, wrapped_vault_key = ?4
       WHERE id = ?5 AND auth_key_hmac = ?6`,
    ).bind(
      JSON.stringify(kdf.value),
      blobOf(kdfSalt),
      blobOf(authKeyHmac),
      blobOf(wrappedVaultKey),
      row.id,
      blobOf(row.authKeyHmac),
    ),
    ...sessionStatements(row.id, deviceName?.device_name ?? 'Device'),
  ])
  if ((updated?.meta.changes ?? 0) === 0) return errorJson(c, 409, 'conflict')
  const response: PasswordResponse = { token }
  return c.json(response)
})

/** TOTP enrollment and logout. Every route here sits behind the bearer middleware. */
export const accountRoutes = new Hono<AppEnv>()

accountRoutes.post('/account/totp', async (c) => {
  const { config } = c.var
  const db = createDb(c.env.DB)
  const row = await db.select().from(account).where(eq(account.id, c.var.accountId)).get()
  if (!row) return unauthorized(c, 'invalid')
  if (row.totpEnabled !== 0) return errorJson(c, 409, 'totp_already_enabled')

  // Asking again before confirming replaces the pending secret and codes.
  const secret = newTotpSecret()
  const recoveryCodes = newRecoveryCodes()
  const [secretEnc, codeHmacs] = await Promise.all([
    encryptTotpSecret(config.totpEncKey, secret),
    hashRecoveryCodes(config.codeHmacKey, recoveryCodes),
  ])
  const written = await c.env.DB.prepare(
    `UPDATE account SET totp_secret_enc = ?, recovery_code_hmacs = ?, totp_last_step = NULL
     WHERE id = ? AND totp_enabled = 0`,
  )
    .bind(blobOf(secretEnc), codeHmacs, row.id)
    .run()
  if (written.meta.changes === 0) return errorJson(c, 409, 'totp_already_enabled')

  const response: TotpEnrollResponse = {
    otpauth_uri: otpauthUri(secret, row.email),
    recovery_codes: [...recoveryCodes],
  }
  return c.json(response)
})

accountRoutes.post('/account/totp/confirm', async (c) => {
  const body = await parseBody(c, totpCodeRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)

  const db = createDb(c.env.DB)
  const row = await db.select().from(account).where(eq(account.id, c.var.accountId)).get()
  if (!row) return unauthorized(c, 'invalid')
  if (row.totpEnabled !== 0) return errorJson(c, 409, 'totp_already_enabled')
  if (!row.totpSecretEnc) return errorJson(c, 422, 'bad_code')

  const secret = await decryptTotpSecret(c.var.config.totpEncKey, row.totpSecretEnc)
  const step = secret
    ? await matchTotpStep(secret, body.value.totp_code, nowSeconds(), row.totpLastStep)
    : null
  if (step === null) return errorJson(c, 422, 'bad_code')

  const written = await c.env.DB.prepare(
    `UPDATE account SET totp_enabled = 1, totp_last_step = ?1
     WHERE id = ?2 AND totp_enabled = 0 AND totp_secret_enc = ?3`,
  )
    .bind(step, row.id, blobOf(row.totpSecretEnc))
    .run()
  if (written.meta.changes === 0) return errorJson(c, 422, 'bad_code')
  return noContent(c)
})

accountRoutes.post('/auth/logout', async (c) => {
  await c.env.DB.prepare(
    'UPDATE device_session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  )
    .bind(nowSeconds(), c.var.sessionId)
    .run()
  return noContent(c)
})
