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

/** Seconds since the Unix epoch. All stored times use this unit. */
export const nowSeconds = (): number => Math.floor(Date.now() / 1000)
