import { nextSeq, openItem, sealItem } from '@securepass/crypto'
import { err, type ItemPayload, ok, type Result, type SyncItem } from '@securepass/shared'
import {
  type Cache,
  type CacheMeta,
  type PendingOp,
  queueLatestOp,
  readItem,
  readItems,
  readMeta,
  readPending,
  writeMeta,
} from '@securepass/shared/cache'
import { editItemPayload, type ItemDraft, newItemPayload, patchItemPayload } from './payload'

/** One entry of the unlocked vault. `damaged` entries failed their tamper check and show as such. */
export type VaultItem =
  | {
      readonly kind: 'item'
      readonly id: string
      readonly revision: number
      /** True while the latest version is still waiting to reach the server. */
      readonly pending: boolean
      readonly payload: ItemPayload
      /** When the server moved the item to the trash, in seconds, or `null`. */
      readonly deletedAt: number | null
      /** True when the server sent an older version of this item than this device had seen. */
      readonly rolledBack: boolean
    }
  | { readonly kind: 'damaged'; readonly id: string }

/** An opened item, as opposed to a damaged one. */
export type OpenVaultItem = Extract<VaultItem, { kind: 'item' }>

/** Why a local write was refused. Nothing was queued. */
export type SaveError =
  | { readonly kind: 'invalid' }
  | { readonly kind: 'seal' }
  | { readonly kind: 'too_large' }
  | { readonly kind: 'not_found' }

/** Latest queued write per item id. A later write replaces an earlier one. */
const latestPending = (pending: readonly PendingOp[]): ReadonlyMap<string, PendingOp> =>
  new Map(pending.map((op) => [op.id, op]))

/**
 * Decrypts every cached item, with queued writes laid over the server rows so a local change
 * shows at once. Decrypted data is returned to the caller and kept only in memory.
 */
export const loadVaultItems = async (
  cache: Cache,
  vaultKey: Uint8Array,
): Promise<readonly VaultItem[]> => {
  const [rows, pending, meta] = await Promise.all([
    readItems(cache),
    readPending(cache),
    readMeta(cache),
  ])
  const queued = latestPending(pending)
  const flagged = new Set(meta?.flagged_rollbacks ?? [])
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
        deletedAt: row?.deleted_at ?? null,
        rolledBack: flagged.has(id),
      }
    }),
  )
  return opened.filter((entry): entry is VaultItem => entry !== null)
}

/** The newest version of one item this device holds: the queued write if any, else the server row. */
const currentVersion = async (
  cache: Cache,
  vaultKey: Uint8Array,
  id: string,
): Promise<{ readonly payload: ItemPayload; readonly revision: number } | null> => {
  const [row, pending] = await Promise.all([readItem(cache, id), readPending(cache)])
  const op = latestPending(pending).get(id)
  const ciphertext = op?.ciphertext ?? row?.ciphertext
  if (!ciphertext) return null
  const payload = await openItem(vaultKey, id, ciphertext)
  return payload.ok ? { payload: payload.value, revision: row?.revision ?? 0 } : null
}

/**
 * Seals a version of an item and queues it for the next sync. Records its `seq` in `seen_seq`.
 * @param baseRevision - The server revision this version was made from (0 for a new item).
 * @returns The updated cache record.
 */
export const queueItemWrite = async (
  cache: Cache,
  vaultKey: Uint8Array,
  id: string,
  payload: ItemPayload,
  baseRevision: number,
  now: Date,
): Promise<Result<CacheMeta, SaveError>> => {
  const meta = await readMeta(cache)
  if (!meta) return err({ kind: 'invalid' })
  const sealed = await sealItem(vaultKey, id, payload)
  if (!sealed.ok) {
    return err({ kind: sealed.error.kind === 'ItemTooLarge' ? 'too_large' : 'seal' })
  }
  await queueLatestOp(cache, {
    op: 'put',
    id,
    base_revision: baseRevision,
    ciphertext: sealed.value,
    trashed: payload.trashed,
    queued_at: now.getTime(),
  })
  // Read again: a sync round may have moved `last_revision` while the item was being sealed.
  const latest = (await readMeta(cache)) ?? meta
  const next: CacheMeta = {
    ...latest,
    seen_seq: { ...latest.seen_seq, [id]: Math.max(latest.seen_seq[id] ?? 0, payload.seq) },
  }
  await writeMeta(cache, next)
  return ok(next)
}

/**
 * Creates a new item from a draft and queues it. The caller then runs a sync, which sends it.
 * @returns The new item's id.
 */
export const createItem = async (
  cache: Cache,
  vaultKey: Uint8Array,
  draft: ItemDraft,
  now: Date = new Date(),
): Promise<Result<string, SaveError>> => {
  const meta = await readMeta(cache)
  if (!meta || draft.name.trim() === '') return err({ kind: 'invalid' })
  const id = crypto.randomUUID()
  const payload = newItemPayload(draft, meta.device_id, now)
  const queued = await queueItemWrite(cache, vaultKey, id, payload, 0, now)
  return queued.ok ? ok(id) : queued
}

/** Applies an edit from a form to an existing item and queues the new version. */
export const updateItem = async (
  cache: Cache,
  vaultKey: Uint8Array,
  id: string,
  draft: ItemDraft,
  now: Date = new Date(),
): Promise<Result<void, SaveError>> => {
  const meta = await readMeta(cache)
  if (!meta || draft.name.trim() === '') return err({ kind: 'invalid' })
  const current = await currentVersion(cache, vaultKey, id)
  if (!current) return err({ kind: 'not_found' })
  const payload = editItemPayload(current.payload, draft, meta.device_id, now, meta.seen_seq[id])
  const queued = await queueItemWrite(cache, vaultKey, id, payload, current.revision, now)
  return queued.ok ? ok(undefined) : queued
}

/** Changes one flag of an item (trash, restore, favorite) or its kept conflict copies. */
export const patchItem = async (
  cache: Cache,
  vaultKey: Uint8Array,
  id: string,
  patch: Partial<Pick<ItemPayload, 'trashed' | 'favorite' | 'conflict_copies'>>,
  now: Date = new Date(),
): Promise<Result<void, SaveError>> => {
  const meta = await readMeta(cache)
  if (!meta) return err({ kind: 'invalid' })
  const current = await currentVersion(cache, vaultKey, id)
  if (!current) return err({ kind: 'not_found' })
  const payload = patchItemPayload(current.payload, patch, meta.device_id, now, meta.seen_seq[id])
  const queued = await queueItemWrite(cache, vaultKey, id, payload, current.revision, now)
  return queued.ok ? ok(undefined) : queued
}

/**
 * Saves a ready made payload as a new item (used by the import and the extension's save prompt).
 * `seq` is set here.
 */
export const createItemFromPayload = async (
  cache: Cache,
  vaultKey: Uint8Array,
  payload: ItemPayload,
  now: Date = new Date(),
): Promise<Result<string, SaveError>> => {
  const id = crypto.randomUUID()
  const queued = await queueItemWrite(
    cache,
    vaultKey,
    id,
    { ...payload, seq: nextSeq(undefined, undefined) },
    0,
    now,
  )
  return queued.ok ? ok(id) : queued
}

/** Clears the "older version" flag on an item once the user has seen the notice. */
export const dismissRollbackFlag = async (cache: Cache, id: string): Promise<void> => {
  const meta = await readMeta(cache)
  if (!meta?.flagged_rollbacks?.includes(id)) return
  await writeMeta(cache, {
    ...meta,
    flagged_rollbacks: meta.flagged_rollbacks.filter((entry) => entry !== id),
  })
}
