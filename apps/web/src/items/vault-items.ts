import { openItem, sealItem } from '@securepass/crypto'
import { err, type ItemPayload, ok, type Result, type SyncItem } from '@securepass/shared'
import {
  type Cache,
  type CacheMeta,
  type PendingOp,
  queueOp,
  readItems,
  readMeta,
  readPending,
  writeMeta,
} from '@securepass/shared/cache'

/** One entry of the unlocked vault. `damaged` entries failed their tamper check and show as such. */
export type VaultItem =
  | {
      readonly kind: 'item'
      readonly id: string
      readonly revision: number
      /** True while the latest version is still waiting to reach the server. */
      readonly pending: boolean
      readonly payload: ItemPayload
    }
  | { readonly kind: 'damaged'; readonly id: string }

/** What the user types into the new login form. */
export type LoginDraft = {
  readonly name: string
  readonly username: string
  readonly password: string
  readonly url: string
  readonly note: string
}

export type CreateLoginError = { readonly kind: 'invalid' } | { readonly kind: 'seal' }

/** The payload for a brand new login: first edit (`seq` 1), not trashed, no folder. */
export const newLoginPayload = (draft: LoginDraft, deviceId: string, now: Date): ItemPayload => {
  const url = draft.url.trim()
  return {
    v: 1,
    seq: 1,
    type: 'login',
    name: draft.name.trim(),
    folder: null,
    favorite: false,
    trashed: false,
    edited_at: now.toISOString(),
    edited_by: deviceId,
    login: {
      username: draft.username.trim(),
      password: draft.password,
      urls: url === '' ? [] : [{ url, match: 'domain' }],
      totp_secret: null,
    },
    note: draft.note,
  }
}

/** Latest queued write per item id. A later write replaces an earlier one. */
const latestPending = (pending: readonly PendingOp[]): ReadonlyMap<string, PendingOp> =>
  new Map(pending.map((op) => [op.id, op]))

/**
 * Decrypts every cached item, with queued writes laid over the server rows so a new login shows at once.
 * Decrypted data is returned to the caller and kept only in memory.
 */
export const loadVaultItems = async (
  cache: Cache,
  vaultKey: Uint8Array,
): Promise<readonly VaultItem[]> => {
  const [rows, pending] = await Promise.all([readItems(cache), readPending(cache)])
  const queued = latestPending(pending)
  const serverById = new Map<string, SyncItem>(rows.map((row) => [row.id, row]))
  const ids = new Set([...serverById.keys(), ...queued.keys()])

  const opened = await Promise.all(
    [...ids].map(async (id): Promise<VaultItem | null> => {
      const op = queued.get(id)
      const row = serverById.get(id)
      const ciphertext = op?.ciphertext ?? row?.ciphertext
      if (!ciphertext) return null
      const payload = await openItem(vaultKey, id, ciphertext)
      if (!payload.ok) return { kind: 'damaged', id }
      return {
        kind: 'item',
        id,
        revision: row?.revision ?? 0,
        pending: op !== undefined,
        payload: payload.value,
      }
    }),
  )
  return opened.filter((entry): entry is VaultItem => entry !== null)
}

/** Items to show in the main list: not trashed, sorted by name. */
export const listedItems = (items: readonly VaultItem[]): readonly VaultItem[] =>
  items
    .filter((item) => item.kind === 'damaged' || !item.payload.trashed)
    .toSorted((a, b) => {
      const nameA = a.kind === 'item' ? a.payload.name : ''
      const nameB = b.kind === 'item' ? b.payload.name : ''
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
    })

/**
 * Seals a new login and queues it. The caller then runs a sync, which sends it.
 * The new item id and `seq` 1 are recorded in `seen_seq` for rollback detection.
 * @returns The updated cache record.
 */
export const createLogin = async (
  cache: Cache,
  vaultKey: Uint8Array,
  draft: LoginDraft,
  now: Date = new Date(),
): Promise<Result<CacheMeta, CreateLoginError>> => {
  const meta = await readMeta(cache)
  if (!meta || draft.name.trim() === '') return err({ kind: 'invalid' })
  const id = crypto.randomUUID()
  const payload = newLoginPayload(draft, meta.device_id, now)
  const sealed = await sealItem(vaultKey, id, payload)
  if (!sealed.ok) return err({ kind: 'seal' })

  await queueOp(cache, {
    op: 'put',
    id,
    base_revision: 0,
    ciphertext: sealed.value,
    trashed: false,
    queued_at: now.getTime(),
  })
  const next: CacheMeta = { ...meta, seen_seq: { ...meta.seen_seq, [id]: payload.seq } }
  await writeMeta(cache, next)
  return ok(next)
}
