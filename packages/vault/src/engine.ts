import { isRollback, nextSeq, openItem, sealItem } from '@securepass/crypto'
import type { Result } from '@securepass/shared'
import { type Cache, readMeta, writeMeta } from '@securepass/shared/cache'
import { type SyncError, type SyncHooks, type SyncOutcome, syncOnce } from '@securepass/shared/sync'
import { resolveConflict } from './conflict'

/**
 * One sync round for an unlocked vault: the shared push and pull, plus the two decisions that need
 * the vault key. A 409 is settled by the conflict rules and sent again; a pulled item that opens
 * to a lower `seq` than this device has seen is flagged and not applied (rollback detection).
 * @param cache - The open local cache.
 * @param vaultKey - The unlocked vault key.
 * @param baseUrl - API origin. Empty for same origin.
 * @param fetcher - `fetch`, injectable for tests.
 * @param now - Clock, injectable for tests.
 */
export const syncVault = async (
  cache: Cache,
  vaultKey: Uint8Array,
  baseUrl = '',
  fetcher: typeof fetch = (input, init) => fetch(input, init),
  now: () => Date = () => new Date(),
): Promise<Result<SyncOutcome, SyncError>> => {
  const meta = await readMeta(cache)
  const seen = new Map<string, number>(Object.entries(meta?.seen_seq ?? {}))
  const flagged = new Set<string>()
  const cleared = new Set<string>()
  const noteSeq = (id: string, seq: number): void => {
    seen.set(id, Math.max(seen.get(id) ?? 0, seq))
  }

  const hooks: SyncHooks = {
    resolveConflict: async (op, current) => {
      // The server never held this id (or lost it): send the queued version as a new item.
      if (!current) return { ciphertext: op.ciphertext, trashed: op.trashed }
      // Purged on the server: the write can never land.
      if (current.purged || current.ciphertext === null) return null
      const local = await openItem(vaultKey, op.id, op.ciphertext)
      if (!local.ok) return null
      const server = await openItem(vaultKey, op.id, current.ciphertext)
      // A damaged server copy cannot win; the local version replaces it.
      if (!server.ok) return { ciphertext: op.ciphertext, trashed: op.trashed }
      noteSeq(op.id, server.value.seq)

      const outcome = resolveConflict(local.value, server.value, current.updated_at, now())
      if (outcome.kind === 'same') return null
      const merged = {
        ...outcome.payload,
        seq: nextSeq(seen.get(op.id), Math.max(local.value.seq, server.value.seq)),
      }
      const sealed = await sealItem(vaultKey, op.id, merged)
      // Too large with the kept copy added: send the winner without the newest copy.
      const fallback = sealed.ok
        ? sealed
        : await sealItem(vaultKey, op.id, {
            ...merged,
            conflict_copies: (merged.conflict_copies ?? []).slice(1),
          })
      if (!fallback.ok) return { ciphertext: op.ciphertext, trashed: op.trashed }
      noteSeq(op.id, merged.seq)
      return { ciphertext: fallback.value, trashed: merged.trashed }
    },
    acceptRow: async (row) => {
      if (row.ciphertext === null) return true
      const opened = await openItem(vaultKey, row.id, row.ciphertext)
      // A row that fails its tamper check is stored and shown as damaged, never as garbled data.
      if (!opened.ok) return true
      if (isRollback(opened.value.seq, seen.get(row.id))) {
        flagged.add(row.id)
        return false
      }
      noteSeq(row.id, opened.value.seq)
      cleared.add(row.id)
      return true
    },
  }

  const result = await syncOnce(cache, baseUrl, fetcher, hooks)

  // Save what this round learned, on top of whatever the round itself wrote (`last_revision`).
  const latest = await readMeta(cache)
  if (latest) {
    const flags = new Set([...(latest.flagged_rollbacks ?? []), ...flagged])
    await writeMeta(cache, {
      ...latest,
      seen_seq: {
        ...latest.seen_seq,
        ...Object.fromEntries(
          [...seen].map(([id, seq]) => [id, Math.max(seq, latest.seen_seq[id] ?? 0)]),
        ),
      },
      ...(flags.size > 0 ? { flagged_rollbacks: [...flags] } : {}),
    })
  }
  return result
}
