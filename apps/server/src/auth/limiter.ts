import type { Context } from 'hono'
import type { AppEnv } from '../app-env'
import { blobOf } from '../lib/bytes'
import { hmacSha256 } from '../lib/hmac'
import { nowSeconds, tooManyRequests } from '../lib/http'

/** What kind of credential check an attempt was. */
export type AttemptKind = 'login' | 'recover' | 'totp'

const WINDOW_SECONDS = 60 * 60
const IP_FAILURE_LIMIT = 5
const ACCOUNT_SLOW_LIMIT = 20
const ACCOUNT_SLOW_MS = 2000
const MAX_RETRY_AFTER = 60 * 60

/**
 * Seconds an IP must wait after `failures` failed checks in the last hour:
 * `60 × 2^(n − 5)`, capped at one hour. Below 5 failures there is no wait.
 * @param failures - Failed credential checks from this IP in the last hour.
 */
export const retryAfterSeconds = (failures: number): number =>
  failures < IP_FAILURE_LIMIT
    ? 0
    : Math.min(MAX_RETRY_AFTER, 60 * 2 ** Math.min(failures - IP_FAILURE_LIMIT, 10))

/** A request the limiter let through. Carries what is needed to record how the check went. */
export type LimiterPass = { readonly ipHash: Uint8Array; readonly kind: AttemptKind }

const ipHashOf = (c: Context<AppEnv>): Promise<Uint8Array> =>
  hmacSha256(c.var.config.ipHashKey, c.req.header('CF-Connecting-IP') ?? 'unknown')

const insertAttempt = (
  c: Context<AppEnv>,
  pass: LimiterPass,
  accountId: string | null,
  outcome: 'failure' | 'blocked',
): Promise<unknown> =>
  c.env.DB.prepare(
    'INSERT INTO login_attempt (id, ip_hash, account_id, kind, at, outcome) VALUES (?, ?, ?, ?, ?, ?)',
  )
    .bind(crypto.randomUUID(), blobOf(pass.ipHash), accountId, pass.kind, nowSeconds(), outcome)
    .run()

/**
 * The per IP gate in front of every credential check. After 5 failed checks within an hour the IP
 * is answered 429 without looking at the credentials, until `Retry-After` seconds have passed since
 * its last failed check. Each further failed check doubles the wait, up to one hour.
 * Refused requests are logged as `blocked` but do not count as failures, so waiting always works.
 * @returns The pass to hand to {@link recordFailure} or {@link recordSuccess}, or the 429 reply.
 */
export const enterLimiter = async (
  c: Context<AppEnv>,
  kind: AttemptKind,
): Promise<{ readonly pass: LimiterPass } | { readonly blocked: Response }> => {
  const pass: LimiterPass = { ipHash: await ipHashOf(c), kind }
  const now = nowSeconds()
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS failures, MAX(at) AS last FROM login_attempt
     WHERE ip_hash = ? AND at > ? AND outcome = 'failure'`,
  )
    .bind(blobOf(pass.ipHash), now - WINDOW_SECONDS)
    .first<{ failures: number; last: number | null }>()
  const wait = retryAfterSeconds(row?.failures ?? 0)
  if (wait > 0 && row?.last != null && now < row.last + wait) {
    await insertAttempt(c, pass, null, 'blocked')
    return { blocked: tooManyRequests(c, wait) }
  }
  return { pass }
}

/**
 * Slows an account under attack from many IPs: after 20 failures in an hour each new attempt
 * waits 2 seconds before it is checked. It never blocks, so the owner cannot be locked out.
 */
export const slowIfAccountUnderAttack = async (
  c: Context<AppEnv>,
  accountId: string,
): Promise<void> => {
  const row = await c.env.DB.prepare(
    `SELECT COUNT(*) AS failures FROM login_attempt
     WHERE account_id = ? AND at > ? AND outcome = 'failure'`,
  )
    .bind(accountId, nowSeconds() - WINDOW_SECONDS)
    .first<{ failures: number }>()
  if ((row?.failures ?? 0) >= ACCOUNT_SLOW_LIMIT) {
    await new Promise((resolve) => setTimeout(resolve, ACCOUNT_SLOW_MS))
  }
}

/** Records a failed check. `accountId` is null for an unknown email, which counts per IP only. */
export const recordFailure = async (
  c: Context<AppEnv>,
  pass: LimiterPass,
  accountId: string | null,
): Promise<void> => {
  await insertAttempt(c, pass, accountId, 'failure')
}

/** A success clears the account counter and this IP's counter. */
export const recordSuccess = async (
  c: Context<AppEnv>,
  pass: LimiterPass,
  accountId: string,
): Promise<void> => {
  await c.env.DB.prepare('DELETE FROM login_attempt WHERE ip_hash = ? OR account_id = ?')
    .bind(blobOf(pass.ipHash), accountId)
    .run()
}
