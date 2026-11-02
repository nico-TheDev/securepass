import { toBase64Url } from '@securepass/crypto'
import type { SyncItem } from '@securepass/shared'
import type { item } from '../db/schema'

/**
 * Turns a stored row into the item shape sync and conflict replies share.
 * @param row - An `item` row.
 */
export const toSyncItem = (row: typeof item.$inferSelect): SyncItem => ({
  id: row.id,
  revision: row.revision,
  ciphertext: row.ciphertext ? toBase64Url(row.ciphertext) : null,
  created_at: row.createdAt,
  updated_at: row.updatedAt,
  deleted_at: row.deletedAt,
  purged: row.purgedAt !== null,
})
