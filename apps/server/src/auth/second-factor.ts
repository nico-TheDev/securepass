import { fromBase64Url, toBase64Url } from '@securepass/crypto'
import type { Context } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import type { account } from '../db/schema'
import { hmacSha256, timingSafeEqual } from '../lib/hmac'
import { nowSeconds, unauthorized } from '../lib/http'
import { decryptTotpSecret, matchTotpStep, normalizeRecoveryCode } from '../lib/totp'
import { enterLimiter, recordFailure, recordSuccess, slowIfAccountUnderAttack } from './limiter'

type AccountRow = typeof account.$inferSelect

/** A second proof that checked out but has not been used up yet. */
export type SecondFactor =
  /** TOTP is not enabled yet (between setup and the forced enrollment), so none is needed. */
  | { readonly kind: 'none' }
  | { readonly kind: 'totp'; readonly step: number }
  | { readonly kind: 'recovery_code'; readonly before: string; readonly after: string }

const codeListSchema = z.array(z.string())

/** The stored recovery code HMACs (base64url), or an empty list if the column is unreadable. */
export const readRecoveryCodeHmacs = (row: AccountRow): readonly string[] => {
  try {
    const parsed = codeListSchema.safeParse(JSON.parse(row.recoveryCodeHmacs))
    return parsed.success ? parsed.data : []
  } catch {
    return []
  }
}

/**
 * Checks a TOTP code or a recovery code without using it up, so a request whose other credential
 * is wrong does not burn a good code.
 * @param allowRecoveryCode - False for "fresh TOTP" checks, which accept only a TOTP code.
 * @returns The proof to pass to {@link consumeSecondFactor}, or `null` when it does not check out.
 */
export const checkSecondFactor = async (
  c: Context<AppEnv>,
  row: AccountRow,
  codes: { readonly totp_code?: string | undefined; readonly recovery_code?: string | undefined },
  allowRecoveryCode: boolean,
): Promise<SecondFactor | null> => {
  if (row.totpEnabled === 0) return { kind: 'none' }
  const { config } = c.var
  if (codes.totp_code !== undefined && row.totpSecretEnc) {
    const secret = await decryptTotpSecret(config.totpEncKey, row.totpSecretEnc)
    if (!secret) return null
    const step = await matchTotpStep(secret, codes.totp_code, nowSeconds(), row.totpLastStep)
    return step === null ? null : { kind: 'totp', step }
  }
  if (allowRecoveryCode && codes.recovery_code !== undefined) {
    const given = await hmacSha256(config.codeHmacKey, normalizeRecoveryCode(codes.recovery_code))
    const stored = readRecoveryCodeHmacs(row)
    let matched = -1
    for (const [index, entry] of stored.entries()) {
      const bytes = fromBase64Url(entry) ?? new Uint8Array()
      if (timingSafeEqual(bytes, given) && matched < 0) matched = index
    }
    if (matched < 0) return null
    return {
      kind: 'recovery_code',
      before: row.recoveryCodeHmacs,
      after: JSON.stringify(stored.filter((_, index) => index !== matched)),
    }
  }
  return null
}

/**
 * Uses up a checked proof in one guarded write: the TOTP step moves forward, or the recovery code
 * is removed. Returns false when another request used the same code first.
 */
export const consumeSecondFactor = async (
  c: Context<AppEnv>,
  accountId: string,
  factor: SecondFactor,
): Promise<boolean> => {
  if (factor.kind === 'none') return true
  const result =
    factor.kind === 'totp'
      ? await c.env.DB.prepare(
          `UPDATE account SET totp_last_step = ?1
           WHERE id = ?2 AND (totp_last_step IS NULL OR totp_last_step < ?1)`,
        )
          .bind(factor.step, accountId)
          .run()
      : await c.env.DB.prepare(
          'UPDATE account SET recovery_code_hmacs = ?1 WHERE id = ?2 AND recovery_code_hmacs = ?3',
        )
          .bind(factor.after, accountId, factor.before)
          .run()
  return result.meta.changes > 0
}

/** Hashes recovery codes for storage as a JSON list of base64url HMACs. */
export const hashRecoveryCodes = async (
  key: Uint8Array,
  codes: readonly string[],
): Promise<string> =>
  JSON.stringify(
    await Promise.all(
      codes.map(async (code) => toBase64Url(await hmacSha256(key, normalizeRecoveryCode(code)))),
    ),
  )

/**
 * The "fresh TOTP" guard for sensitive actions: the body must carry a valid, unused TOTP code.
 * It shares the login limiter. While TOTP is not enabled yet there is nothing to check.
 * @returns `null` when the action may go ahead, else the 401 or 429 reply.
 */
export const requireFreshTotp = async (
  c: Context<AppEnv>,
  row: AccountRow,
  totpCode: string | undefined,
): Promise<Response | null> => {
  if (row.totpEnabled === 0) return null
  const gate = await enterLimiter(c, 'totp')
  if ('blocked' in gate) return gate.blocked
  await slowIfAccountUnderAttack(c, row.id)
  const factor = await checkSecondFactor(c, row, { totp_code: totpCode }, false)
  if (!factor || !(await consumeSecondFactor(c, row.id, factor))) {
    await recordFailure(c, gate.pass, row.id)
    return unauthorized(c, 'invalid')
  }
  await recordSuccess(c, gate.pass, row.id)
  return null
}
