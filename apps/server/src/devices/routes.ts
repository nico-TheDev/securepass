import { type DevicesResponse, freshTotpRequestSchema } from '@securepass/shared'
import { and, asc, eq, gt, isNull } from 'drizzle-orm'
import { Hono } from 'hono'
import type { AppEnv } from '../app-env'
import { requireFreshTotp } from '../auth/second-factor'
import { createDb } from '../db/client'
import { account, deviceSession } from '../db/schema'
import { parseBody } from '../lib/body'
import { errorJson, noContent, nowSeconds, unauthorized } from '../lib/http'

/** Device list and revoke. Every route here sits behind the bearer middleware. */
export const deviceRoutes = new Hono<AppEnv>()

deviceRoutes.get('/devices', async (c) => {
  const db = createDb(c.env.DB)
  const rows = await db
    .select()
    .from(deviceSession)
    .where(
      and(
        eq(deviceSession.accountId, c.var.accountId),
        isNull(deviceSession.revokedAt),
        gt(deviceSession.expiresAt, nowSeconds()),
      ),
    )
    .orderBy(asc(deviceSession.createdAt))
    .all()
  const response: DevicesResponse = {
    devices: rows.map((row) => ({
      id: row.id,
      name: row.deviceName,
      created_at: row.createdAt,
      last_seen_at: row.lastSeenAt,
      current: row.id === c.var.sessionId,
    })),
  }
  return c.json(response)
})

deviceRoutes.delete('/devices/:id', async (c) => {
  const body = await parseBody(c, freshTotpRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)

  const db = createDb(c.env.DB)
  const owner = await db.select().from(account).where(eq(account.id, c.var.accountId)).get()
  if (!owner) return unauthorized(c, 'invalid')
  const target = await db
    .select({ id: deviceSession.id })
    .from(deviceSession)
    .where(
      and(
        eq(deviceSession.id, c.req.param('id')),
        eq(deviceSession.accountId, owner.id),
        isNull(deviceSession.revokedAt),
      ),
    )
    .get()
  if (!target) return errorJson(c, 404, 'not_found')

  const refused = await requireFreshTotp(c, owner, body.value.totp_code)
  if (refused) return refused

  // The current device may revoke itself, which logs it out.
  await c.env.DB.prepare(
    'UPDATE device_session SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL',
  )
    .bind(nowSeconds(), target.id)
    .run()
  return noContent(c)
})
