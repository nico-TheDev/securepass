import {
  conflictResponseSchema,
  type SyncItem,
  syncResponseSchema,
  type UnauthorizedCode,
} from '../api'
import {
  applySyncPage,
  type Cache,
  type PendingOp,
  readItem,
  readMeta,
  readPending,
  removePending,
  rewritePending,
} from '../cache/cache'
import { err, ok, type Result } from '../result'

/** Why a sync round stopped. `unauthorized` carries the server's reason so the app can react. */
export type SyncError =
  | { readonly kind: 'unauthorized'; readonly code: UnauthorizedCode }
  | { readonly kind: 'no_account' }
  | { readonly kind: 'network' }
  | { readonly kind: 'conflict'; readonly id: string }
  | { readonly kind: 'server'; readonly status: number }

/** What a finished round did. */
export type SyncOutcome = {
  readonly pushed: number
  readonly pulled: number
  /** Ids of pulled rows the `acceptRow` hook refused (an older version than this device has seen). */
  readonly rejected: readonly string[]
  /** True when the server asked this device to drop its items and take everything again. */
  readonly fullResync: boolean
}

/** What a conflict hook decides to send instead of the queued write. `null` drops the write. */
export type ConflictResolution = {
  readonly ciphertext: string
  readonly trashed: boolean
} | null

/**
 * The parts of a round that need the vault key, supplied by the app because this package cannot
 * decrypt anything.
 */
export type SyncHooks = {
  /**
   * Called on a 409 with the queued write and the row the server holds now (`null` if it has none).
   * Returns the merged version to send with the new base revision, or `null` to drop the write.
   */
  readonly resolveConflict?: (
    op: PendingOp,
    current: SyncItem | null,
  ) => Promise<ConflictResolution>
  /**
   * Called for every pulled row that is not purged, with the row this device already holds.
   * Returning false keeps the cached copy (rollback detection).
   */
  readonly acceptRow?: (row: SyncItem, cached: SyncItem | undefined) => Promise<boolean>
}

const MAX_CONFLICT_ROUNDS = 3

const readUnauthorized = async (response: Response): Promise<SyncError> => {
  const body: unknown = await response.json().catch(() => null)
  const code = (body as { code?: unknown } | null)?.code
  return {
    kind: 'unauthorized',
    code: code === 'expired' || code === 'revoked' ? code : 'invalid',
  }
}

/**
 * One sync round: send the queued writes in order, then pull everything newer than `last_revision`.
 * A 409 goes to the `resolveConflict` hook, and the merged result is sent again with the new base
 * revision, so a replay never overwrites blindly. Without a hook the round stops with `conflict`.
 * A 410 (the item was purged) drops the write. Network failures and 401s leave the queue untouched.
 * @param cache - The open local cache.
 * @param baseUrl - API origin. Empty for same origin.
 * @param fetcher - `fetch`, injectable for tests.
 * @param hooks - Conflict and rollback decisions, made by the caller that holds the vault key.
 */
export const syncOnce = async (
  cache: Cache,
  baseUrl = '',
  fetcher: typeof fetch = fetch,
  hooks: SyncHooks = {},
): Promise<Result<SyncOutcome, SyncError>> => {
  const meta = await readMeta(cache)
  if (!meta) return err({ kind: 'no_account' })
  const headers = { Authorization: `Bearer ${meta.token}` }

  const send = (op: PendingOp): Promise<Response> =>
    fetcher(`${baseUrl}/api/items/${op.id}`, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/json',
        'If-Match': String(op.base_revision),
      },
      body: JSON.stringify({ ciphertext: op.ciphertext, trashed: op.trashed }),
    })

  try {
    let pushed = 0
    for (const queued of await readPending(cache)) {
      if (queued.op !== 'put') {
        if (queued.seq !== undefined) await removePending(cache, queued.seq)
        continue
      }
      let op = queued
      let response = await send(op)
      for (let round = 0; response.status === 409 && round < MAX_CONFLICT_ROUNDS; round++) {
        if (!hooks.resolveConflict) return err({ kind: 'conflict', id: op.id })
        const body = conflictResponseSchema.safeParse(await response.json().catch(() => null))
        if (!body.success) return err({ kind: 'server', status: 502 })
        const resolution = await hooks.resolveConflict(op, body.data.current)
        if (!resolution) {
          response = new Response(null, { status: 204 })
          break
        }
        op = { ...op, ...resolution, base_revision: body.data.current?.revision ?? 0 }
        await rewritePending(cache, op)
        response = await send(op)
      }
      if (response.status === 401) return err(await readUnauthorized(response))
      if (response.status === 409) return err({ kind: 'conflict', id: op.id })
      // 410 means the item was purged on the server, so the write can never land.
      if (!response.ok && response.status !== 410)
        return err({ kind: 'server', status: response.status })
      if (op.seq !== undefined) await removePending(cache, op.seq)
      pushed += 1
    }

    const response = await fetcher(`${baseUrl}/api/sync?since=${meta.last_revision}`, { headers })
    if (response.status === 401) return err(await readUnauthorized(response))
    if (!response.ok) return err({ kind: 'server', status: response.status })
    const page = syncResponseSchema.safeParse(await response.json())
    if (!page.success) return err({ kind: 'server', status: 502 })
    const { items, revision, full_resync } = page.data

    const rejected: string[] = []
    const accepted: SyncItem[] = []
    for (const row of items) {
      const keep =
        row.purged ||
        !hooks.acceptRow ||
        (await hooks.acceptRow(row, await readItem(cache, row.id)))
      if (keep) accepted.push(row)
      else rejected.push(row.id)
    }
    // On a full resync the rows this device refused keep their cached copy.
    const kept = full_resync
      ? (await Promise.all(rejected.map((id) => readItem(cache, id)))).filter(
          (row): row is SyncItem => row !== undefined,
        )
      : []
    await applySyncPage(cache, [...kept, ...accepted], revision, full_resync)
    return ok({ pushed, pulled: items.length, rejected, fullResync: full_resync })
  } catch {
    return err({ kind: 'network' })
  }
}
