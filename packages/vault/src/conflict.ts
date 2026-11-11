import type { ItemPayload } from '@securepass/shared'
import { pushPasswordHistory } from './payload'

/** A device clock may run this far ahead of the server before its edit stops counting as newer. */
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000
const MAX_CONFLICT_COPIES = 5

type Copy = NonNullable<ItemPayload['conflict_copies']>[number]

/** How a conflict between the queued local version and the server's version ends. */
export type ConflictOutcome =
  /** Both sides hold the same edit; the queued write can be dropped. */
  | { readonly kind: 'same' }
  /**
   * The version to seal and send with the new base revision. `seq` still has to be set by the
   * caller. `winner` says which side it was built from.
   */
  | { readonly kind: 'merged'; readonly winner: 'local' | 'server'; readonly payload: ItemPayload }

const time = (payload: ItemPayload): number => Date.parse(payload.edited_at)

const withoutCopies = (payload: ItemPayload): Copy['payload'] => {
  const { conflict_copies: _copies, ...rest } = payload
  return rest
}

const sameEdit = (a: ItemPayload, b: ItemPayload): boolean =>
  a.edited_at === b.edited_at &&
  a.edited_by === b.edited_by &&
  JSON.stringify(withoutCopies({ ...a, seq: 0 })) ===
    JSON.stringify(withoutCopies({ ...b, seq: 0 }))

/** Picks the winning side by the rules in spec 0003: edit after trash, then newer, then device id. */
const pickWinner = (
  local: ItemPayload,
  server: ItemPayload,
  serverUpdatedAtMs: number,
): { readonly winner: 'local' | 'server'; readonly restore: boolean } => {
  // Rule 1: one side trashed, the other edited after the trash: the edit wins and is restored.
  if (local.trashed !== server.trashed) {
    const edit = local.trashed ? server : local
    const trash = local.trashed ? local : server
    if (time(edit) > time(trash)) {
      return { winner: edit === local ? 'local' : 'server', restore: true }
    }
  }
  // Rule 2: the newer edit wins, unless its clock is more than 5 minutes ahead of the server's
  // time for the item. A fast device clock loses to the server copy.
  const localFast = time(local) > serverUpdatedAtMs + MAX_CLOCK_SKEW_MS
  if (localFast) return { winner: 'server', restore: false }
  if (time(local) !== time(server)) {
    return { winner: time(local) > time(server) ? 'local' : 'server', restore: false }
  }
  // Rule 3: a tie goes to the higher device id.
  return { winner: local.edited_by > server.edited_by ? 'local' : 'server', restore: false }
}

/**
 * Settles a sync conflict (a 409) between the queued local version and the server's version.
 * The losing version is kept whole in the winner's `conflict_copies` (5 newest kept), and its
 * password goes to the winner's history when it differs. No edit is silently lost.
 * @param local - The version this device queued.
 * @param server - The version the server holds now.
 * @param serverUpdatedAt - The server's `updated_at` for the item, in seconds.
 * @param now - This device's time, used for `kept_at` and `replaced_at`.
 */
export const resolveConflict = (
  local: ItemPayload,
  server: ItemPayload,
  serverUpdatedAt: number,
  now: Date,
): ConflictOutcome => {
  if (sameEdit(local, server)) return { kind: 'same' }

  // The server copy is this device's own earlier write (a newer edit was queued while the older
  // one was still on its way). That is not a conflict: the newer edit simply goes on top.
  if (server.edited_by === local.edited_by && server.seq < local.seq) {
    return { kind: 'merged', winner: 'local', payload: local }
  }

  const { winner, restore } = pickWinner(local, server, serverUpdatedAt * 1000)
  const win = winner === 'local' ? local : server
  const lose = winner === 'local' ? server : local
  const stamp = now.toISOString()

  const seen = new Set<string>()
  const copies = [
    { payload: withoutCopies(lose), kept_at: stamp },
    ...(win.conflict_copies ?? []),
    ...(lose.conflict_copies ?? []),
  ]
    .filter((copy) => {
      const key = `${copy.payload.edited_at}|${copy.payload.edited_by}|${copy.payload.seq}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })
    .slice(0, MAX_CONFLICT_COPIES)

  const losingPassword = lose.login?.password ?? ''
  const history =
    win.login && losingPassword !== win.login.password
      ? pushPasswordHistory(win.password_history, losingPassword, stamp)
      : win.password_history

  return {
    kind: 'merged',
    winner,
    payload: {
      ...win,
      trashed: restore ? false : win.trashed,
      conflict_copies: copies,
      ...(history && history.length > 0 ? { password_history: history } : {}),
    },
  }
}
