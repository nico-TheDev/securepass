import { log } from '../lib/logger'

/** Tombstones are kept 90 days so every device has time to learn about a purge. */
export const TOMBSTONE_RETENTION_SECONDS = 90 * 24 * 60 * 60
const ATTEMPT_RETENTION_SECONDS = 30 * 24 * 60 * 60

/**
 * The daily job: purge trashed items past their 30 days, delete tombstones older than 90 days
 * (keeping the newest expired one as the `full_resync` marker), and clear out old login attempts
 * and expired sessions.
 * @param db - The D1 binding.
 * @param now - Current time in seconds.
 */
export const runDailyPurge = async (db: D1Database, now: number): Promise<void> => {
  const accounts = await db.prepare('SELECT id FROM account').all<{ id: string }>()
  let purged = 0
  for (const { id } of accounts.results) {
    // All items due for purge become tombstones under one new revision, in one transaction.
    const [written] = await db.batch([
      db
        .prepare(
          `UPDATE item SET revision = (SELECT revision + 1 FROM account WHERE id = ?1),
             ciphertext = NULL, size = 0, updated_at = ?2, purged_at = ?2
           WHERE account_id = ?1 AND purged_at IS NULL AND purge_after IS NOT NULL
             AND purge_after <= ?2`,
        )
        .bind(id, now),
      db
        .prepare('UPDATE account SET revision = revision + 1 WHERE id = ? AND changes() > 0')
        .bind(id),
    ])
    purged += written?.meta.changes ?? 0
  }

  const tombstoneCutoff = now - TOMBSTONE_RETENTION_SECONDS
  const [tombstones, attempts, sessions] = await db.batch([
    db
      .prepare(
        `DELETE FROM item WHERE purged_at IS NOT NULL AND purged_at <= ?1
           AND revision < (SELECT MAX(revision) FROM item AS newest
             WHERE newest.account_id = item.account_id AND newest.purged_at IS NOT NULL
               AND newest.purged_at <= ?1)`,
      )
      .bind(tombstoneCutoff),
    db.prepare('DELETE FROM login_attempt WHERE at <= ?').bind(now - ATTEMPT_RETENTION_SECONDS),
    db.prepare('DELETE FROM device_session WHERE expires_at <= ?').bind(now),
  ])
  log('info', 'daily_purge', {
    purged,
    tombstones_deleted: tombstones?.meta.changes ?? 0,
    attempts_deleted: attempts?.meta.changes ?? 0,
    sessions_deleted: sessions?.meta.changes ?? 0,
  })
}
