import { err, ok, type Result } from '@securepass/shared'

/** 30 days, how long a trashed item waits before the daily purge. */
export const TRASH_RETENTION_SECONDS = 30 * 24 * 60 * 60

/** The parts of a stored item the write rules look at. */
export type StoredItem = {
  readonly revision: number
  readonly deletedAt: number | null
  readonly purgeAfter: number | null
  readonly purgedAt: number | null
}

/** The trash fields a successful write will store. */
export type WritePlan = {
  readonly deletedAt: number | null
  readonly purgeAfter: number | null
}

/** Why a write is refused: a stale base revision, or the item is gone for good. */
export type WriteRefusal = 'conflict' | 'purged'

/**
 * Decides whether a `PUT` may go ahead and what trash state it stores.
 * `existing` is `null` for an id the server has not seen. `baseRevision` 0 means "new item".
 * Restoring an item past `purge_after` is refused even before the daily purge has run.
 * @param existing - The stored item, or `null`.
 * @param baseRevision - The `If-Match` value.
 * @param trashed - The client's `trashed` flag.
 * @param now - Current time in seconds.
 */
export const planWrite = (
  existing: StoredItem | null,
  baseRevision: number,
  trashed: boolean,
  now: number,
): Result<WritePlan, WriteRefusal> => {
  if (existing?.purgedAt != null) return err('purged')
  if ((existing?.revision ?? 0) !== baseRevision) return err('conflict')
  if (existing && !trashed && existing.deletedAt !== null) {
    if (existing.purgeAfter !== null && existing.purgeAfter <= now) return err('purged')
  }
  if (!trashed) return ok({ deletedAt: null, purgeAfter: null })
  return ok({
    // A second trashed write keeps the first trash time; purge always counts from this write.
    deletedAt: existing?.deletedAt ?? now,
    purgeAfter: now + TRASH_RETENTION_SECONDS,
  })
}
