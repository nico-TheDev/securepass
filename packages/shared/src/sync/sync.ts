import { type SyncResponse, syncResponseSchema, type UnauthorizedCode } from '../api'
import { applySyncPage, type Cache, readMeta, readPending, removePending } from '../cache/cache'
import { err, ok, type Result } from '../result'

/** Why a sync round stopped. `unauthorized` carries the server's reason so the app can react. */
export type SyncError =
  | { readonly kind: 'unauthorized'; readonly code: UnauthorizedCode }
  | { readonly kind: 'no_account' }
  | { readonly kind: 'network' }
  | { readonly kind: 'conflict'; readonly id: string }
  | { readonly kind: 'server'; readonly status: number }

/** What a finished round did. */
export type SyncOutcome = { readonly pushed: number; readonly pulled: number }

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
 * A 409 stops the round with `conflict` and leaves that write queued (conflict rules come later).
 * A 410 (the item was purged) drops the write. Network failures leave the queue untouched.
 * @param cache - The open local cache.
 * @param baseUrl - API origin. Empty for same origin.
 * @param fetcher - `fetch`, injectable for tests.
 */
export const syncOnce = async (
  cache: Cache,
  baseUrl = '',
  fetcher: typeof fetch = fetch,
): Promise<Result<SyncOutcome, SyncError>> => {
  const meta = await readMeta(cache)
  if (!meta) return err({ kind: 'no_account' })
  const headers = { Authorization: `Bearer ${meta.token}` }

  try {
    let pushed = 0
    for (const op of await readPending(cache)) {
      const response = await fetcher(`${baseUrl}/api/items/${op.id}`, {
        method: 'PUT',
        headers: {
          ...headers,
          'Content-Type': 'application/json',
          'If-Match': String(op.base_revision),
        },
        body: JSON.stringify({ ciphertext: op.ciphertext, trashed: op.trashed }),
      })
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
    const { items, revision }: SyncResponse = page.data
    await applySyncPage(cache, items, revision)
    return ok({ pushed, pulled: items.length })
  } catch {
    return err({ kind: 'network' })
  }
}
