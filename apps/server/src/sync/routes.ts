import type { SyncResponse } from '@securepass/shared'
import { and, asc, eq, gt } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import { createDb } from '../db/client'
import { account, item } from '../db/schema'
import { errorJson } from '../lib/http'
import { toSyncItem } from './mapper'

const sinceSchema = z
  .string()
  .regex(/^\d{1,15}$/)
  .default('0')

/** `GET /api/sync`. Sits behind the bearer middleware. */
export const syncRoutes = new Hono<AppEnv>()

syncRoutes.get('/sync', async (c) => {
  const since = sinceSchema.safeParse(c.req.query('since'))
  if (!since.success) return errorJson(c, 400, 'invalid_request')

  const { accountId } = c.var
  const db = createDb(c.env.DB)
  const [rows, owner] = await Promise.all([
    db
      .select()
      .from(item)
      .where(and(eq(item.accountId, accountId), gt(item.revision, Number(since.data))))
      .orderBy(asc(item.revision))
      .all(),
    db.select({ revision: account.revision }).from(account).where(eq(account.id, accountId)).get(),
  ])

  // `full_resync` needs the tombstone purge job (a later build task); until it exists no
  // tombstone is ever deleted, so a client never misses one.
  const response: SyncResponse = {
    items: rows.map(toSyncItem),
    revision: owner?.revision ?? 0,
    full_resync: false,
  }
  return c.json(response)
})
