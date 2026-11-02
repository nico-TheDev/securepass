import { fromBase64Url } from '@securepass/crypto'
import { and, eq } from 'drizzle-orm'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../app-env'
import { createDb } from '../db/client'
import { deviceSession } from '../db/schema'
import { sha256 } from '../lib/hmac'
import { nowSeconds, unauthorized } from '../lib/http'

/** Sessions last 30 days from their last use. */
export const SESSION_TTL_SECONDS = 30 * 24 * 60 * 60
const LAST_SEEN_INTERVAL_SECONDS = 60

/**
 * Resolves the bearer token to an unrevoked, unexpired session, else answers 401 with a code.
 * Sets `accountId` and `sessionId`. Refreshes `last_seen_at` and the sliding expiry at most once a minute.
 */
export const bearerAuth = createMiddleware<AppEnv>(async (c, next) => {
  const header = c.req.header('Authorization') ?? ''
  const match = /^Bearer ([A-Za-z0-9_-]+)$/.exec(header)
  const raw = match?.[1] ? fromBase64Url(match[1]) : null
  if (raw?.length !== 32) return unauthorized(c, 'invalid')

  const db = createDb(c.env.DB)
  const tokenHash = await sha256(raw)
  const session = await db
    .select()
    .from(deviceSession)
    .where(eq(deviceSession.tokenHash, tokenHash))
    .get()
  if (!session) return unauthorized(c, 'invalid')
  if (session.revokedAt !== null) return unauthorized(c, 'revoked')

  const now = nowSeconds()
  if (session.expiresAt <= now) return unauthorized(c, 'expired')

  if (now - session.lastSeenAt >= LAST_SEEN_INTERVAL_SECONDS) {
    c.executionCtx.waitUntil(
      db
        .update(deviceSession)
        .set({ lastSeenAt: now, expiresAt: now + SESSION_TTL_SECONDS })
        .where(and(eq(deviceSession.id, session.id)))
        .run(),
    )
  }
  c.set('accountId', session.accountId)
  c.set('sessionId', session.id)
  await next()
})
