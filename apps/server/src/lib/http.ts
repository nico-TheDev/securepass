import type { UnauthorizedCode } from '@securepass/shared'
import type { Context } from 'hono'
import type { AppEnv } from '../app-env'

/** A JSON error reply with the one shape every client reads: `{ error }`. */
export const errorJson = (
  c: Context<AppEnv>,
  status: 400 | 404 | 409 | 410 | 413 | 422 | 500,
  error: string,
  extra: Record<string, unknown> = {},
): Response => c.json({ error, ...extra }, status)

/** A 401 carrying `code`, so a client can tell bad credentials from an expired or revoked session. */
export const unauthorized = (c: Context<AppEnv>, code: UnauthorizedCode): Response =>
  c.json({ error: 'unauthorized', code }, 401)

/** A 429 from the login limiter, with the seconds to wait in `Retry-After`. */
export const tooManyRequests = (c: Context<AppEnv>, retryAfter: number): Response =>
  c.json({ error: 'too_many_requests', retry_after: retryAfter }, 429, {
    'Retry-After': String(retryAfter),
  })

/** An empty 204 reply. */
export const noContent = (c: Context<AppEnv>): Response => c.body(null, 204)

/** Seconds since the Unix epoch. All stored times use this unit. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
