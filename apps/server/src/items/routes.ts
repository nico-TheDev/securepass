import { fromBase64Url } from '@securepass/crypto'
import { freshTotpRequestSchema, putItemRequestSchema } from '@securepass/shared'
import { and, eq } from 'drizzle-orm'
import { Hono } from 'hono'
import { z } from 'zod'
import type { AppEnv } from '../app-env'
import { requireFreshTotp } from '../auth/second-factor'
import { createDb } from '../db/client'
import { account, item, MAX_ITEM_SIZE } from '../db/schema'
import { parseBody } from '../lib/body'
import { blobOf } from '../lib/bytes'
import { errorJson, noContent, nowSeconds, unauthorized } from '../lib/http'
import { toSyncItem } from '../sync/mapper'
import { planWrite } from './rules'

const itemIdSchema = z.uuid()
const baseRevisionSchema = z.string().regex(/^\d{1,15}$/)

/** Item writes. Every route here sits behind the bearer middleware. */
export const itemRoutes = new Hono<AppEnv>()

itemRoutes.put('/items/:id', async (c) => {
  const id = itemIdSchema.safeParse(c.req.param('id'))
  const ifMatch = baseRevisionSchema.safeParse(c.req.header('If-Match'))
  if (!id.success || !ifMatch.success) return errorJson(c, 400, 'invalid_request')
  const body = await parseBody(c, putItemRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)

  const ciphertext = fromBase64Url(body.value.ciphertext)
  if (!ciphertext || ciphertext.length === 0) return errorJson(c, 400, 'invalid_request')
  if (ciphertext.length > MAX_ITEM_SIZE) return errorJson(c, 413, 'item_too_large')

  const { accountId } = c.var
  const baseRevision = Number(ifMatch.data)
  const db = createDb(c.env.DB)
  const findItem = () =>
    db
      .select()
      .from(item)
      .where(and(eq(item.id, id.data), eq(item.accountId, accountId)))
      .get()

  const existing = (await findItem()) ?? null
  const now = nowSeconds()
  const plan = planWrite(existing, baseRevision, body.value.trashed, now)
  if (!plan.ok) {
    return plan.error === 'purged'
      ? errorJson(c, 410, 'item_purged')
      : errorJson(c, 409, 'conflict', { current: existing ? toSyncItem(existing) : null })
  }
  const { deletedAt, purgeAfter } = plan.value

  // One D1 batch is one transaction. The item write is guarded by the base revision, and the
  // account revision only moves if the item write changed a row, so a stale write from a second
  // device that slipped past the read above changes nothing and is answered 409 below.
  const write = existing
    ? c.env.DB.prepare(
        `UPDATE item SET revision = (SELECT revision + 1 FROM account WHERE id = ?1),
           ciphertext = ?2, size = ?3, updated_at = ?4, deleted_at = ?5, purge_after = ?6
         WHERE id = ?7 AND account_id = ?1 AND revision = ?8 AND purged_at IS NULL`,
      ).bind(
        accountId,
        blobOf(ciphertext),
        ciphertext.length,
        now,
        deletedAt,
        purgeAfter,
        id.data,
        baseRevision,
      )
    : c.env.DB.prepare(
        `INSERT INTO item (id, account_id, revision, ciphertext, size, created_at, updated_at,
           deleted_at, purge_after)
         SELECT ?1, ?2, a.revision + 1, ?3, ?4, ?5, ?5, ?6, ?7 FROM account a
         WHERE a.id = ?2 AND NOT EXISTS (SELECT 1 FROM item WHERE id = ?1)`,
      ).bind(id.data, accountId, blobOf(ciphertext), ciphertext.length, now, deletedAt, purgeAfter)

  const [written, , revisionRow] = await c.env.DB.batch([
    write,
    c.env.DB.prepare(
      'UPDATE account SET revision = revision + 1 WHERE id = ? AND changes() > 0',
    ).bind(accountId),
    c.env.DB.prepare('SELECT revision FROM account WHERE id = ?').bind(accountId),
  ])

  if ((written?.meta.changes ?? 0) === 0) {
    const current = await findItem()
    return errorJson(c, 409, 'conflict', { current: current ? toSyncItem(current) : null })
  }
  const revision = (revisionRow?.results[0] as { revision: number } | undefined)?.revision
  if (revision === undefined) return errorJson(c, 500, 'write_failed')

  return c.json({ revision, updated_at: now, purge_after: purgeAfter })
})

itemRoutes.delete('/items/:id', async (c) => {
  const id = itemIdSchema.safeParse(c.req.param('id'))
  const ifMatch = baseRevisionSchema.safeParse(c.req.header('If-Match'))
  if (!id.success || !ifMatch.success) return errorJson(c, 400, 'invalid_request')
  const body = await parseBody(c, freshTotpRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)

  const { accountId } = c.var
  const db = createDb(c.env.DB)
  const owner = await db.select().from(account).where(eq(account.id, accountId)).get()
  if (!owner) return unauthorized(c, 'invalid')
  const findItem = () =>
    db
      .select()
      .from(item)
      .where(and(eq(item.id, id.data), eq(item.accountId, accountId)))
      .get()
  const existing = await findItem()
  if (!existing || existing.purgedAt !== null) return errorJson(c, 404, 'not_found')
  if (existing.revision !== Number(ifMatch.data)) {
    return errorJson(c, 409, 'conflict', { current: toSyncItem(existing) })
  }

  const refused = await requireFreshTotp(c, owner, body.value.totp_code)
  if (refused) return refused

  // A permanent delete leaves a tombstone with a new revision, so every device learns about it.
  const now = nowSeconds()
  const [written] = await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE item SET revision = (SELECT revision + 1 FROM account WHERE id = ?1),
         ciphertext = NULL, size = 0, updated_at = ?2, deleted_at = COALESCE(deleted_at, ?2),
         purged_at = ?2
       WHERE id = ?3 AND account_id = ?1 AND revision = ?4 AND purged_at IS NULL`,
    ).bind(accountId, now, id.data, existing.revision),
    c.env.DB.prepare(
      'UPDATE account SET revision = revision + 1 WHERE id = ? AND changes() > 0',
    ).bind(accountId),
  ])
  if ((written?.meta.changes ?? 0) === 0) {
    const current = await findItem()
    return errorJson(c, 409, 'conflict', { current: current ? toSyncItem(current) : null })
  }
  return noContent(c)
})

itemRoutes.delete('/trash', async (c) => {
  const body = await parseBody(c, freshTotpRequestSchema)
  if (!body.ok) return errorJson(c, 400, body.error)

  const { accountId } = c.var
  const db = createDb(c.env.DB)
  const owner = await db.select().from(account).where(eq(account.id, accountId)).get()
  if (!owner) return unauthorized(c, 'invalid')
  const refused = await requireFreshTotp(c, owner, body.value.totp_code)
  if (refused) return refused

  // Every trashed item becomes a tombstone under one new revision, in one transaction.
  const now = nowSeconds()
  await c.env.DB.batch([
    c.env.DB.prepare(
      `UPDATE item SET revision = (SELECT revision + 1 FROM account WHERE id = ?1),
         ciphertext = NULL, size = 0, updated_at = ?2, purged_at = ?2
       WHERE account_id = ?1 AND deleted_at IS NOT NULL AND purged_at IS NULL`,
    ).bind(accountId, now),
    c.env.DB.prepare(
      'UPDATE account SET revision = revision + 1 WHERE id = ? AND changes() > 0',
    ).bind(accountId),
  ])
  return noContent(c)
})
