import type { SyncResponse } from '@securepass/shared'
import { and, asc, eq, gt } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import { TOMBSTONE_RETENTION_SECONDS } from '../cron/purge'
import { createDb } from '../db/client'
import { account, item } from '../db/schema'
import { errorJson, nowSeconds } from '../lib/http'
import { toSyncItem } from './mapper'

const sinceSchema = z
  .string()
  .regex(/^\d{1,15}$/)
  .default('0')

/** `GET /api/sync`. Sits behind the bearer middleware. */
export const syncRoutes = new Hono<AppEnv>()

syncRoutes.get('/sync', async (c) => {
  const parsed = sinceSchema.safeParse(c.req.query('since'))
  if (!parsed.success) return errorJson(c, 400, 'invalid_request')
  const since = Number(parsed.data)

  const { accountId } = c.var
  const db = createDb(c.env.DB)

  // Tombstones are deleted 90 days after the purge. The purge job always keeps the newest expired
  // one as a marker, so a device that last synced before that marker may have missed a tombstone
  // that no longer exists. It is told to drop its items and take everything again.
  const marker = await c.env.DB.prepare(
    `SELECT MAX(revision) AS revision FROM item
     WHERE account_id = ? AND purged_at IS NOT NULL AND purged_at <= ?`,
  )
    .bind(accountId, nowSeconds() - TOMBSTONE_RETENTION_SECONDS)
    .first<{ revision: number | null }>()
  const fullResync = since > 0 && marker?.revision != null && since < marker.revision

  const [rows, owner] = await Promise.all([
    db
      .select()
      .from(item)
      .where(and(eq(item.accountId, accountId), gt(item.revision, fullResync ? 0 : since)))
      .orderBy(asc(item.revision))
      .all(),
    db.select({ revision: account.revision }).from(account).where(eq(account.id, accountId)).get(),
  ])

  const response: SyncResponse = {
    items: rows.map(toSyncItem),
    revision: owner?.revision ?? 0,
    full_resync: fullResync,
  }
  return c.json(response)
})
