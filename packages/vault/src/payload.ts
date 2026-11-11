import { nextSeq } from '@securepass/crypto'
import type { ItemPayload } from '@securepass/shared'
import { normalizeUrl, type SavedUrl } from './url'

/** The identity fields of an item. Every one may be empty. */
export type IdentityFields = NonNullable<ItemPayload['identity']>

/** The names of the identity fields, in the order forms show them. */
export const IDENTITY_KEYS = [
  'title',
  'first',
  'last',
  'email',
  'phone',
  'address1',
  'address2',
  'city',
  'region',
  'postal',
  'country',
] as const satisfies readonly (keyof IdentityFields)[]

/** What a person edits in an item form. Sync bookkeeping (`seq`, times, history) is not here. */
export type ItemDraft = {
  readonly type: ItemPayload['type']
  readonly name: string
  readonly folder: string
  readonly favorite: boolean
  readonly note: string
  readonly username: string
  readonly password: string
  readonly urls: readonly SavedUrl[]
  readonly totpSecret: string
  readonly identity: Readonly<Record<keyof IdentityFields, string>>
}

const EMPTY_IDENTITY = Object.fromEntries(IDENTITY_KEYS.map((key) => [key, ''])) as Record<
  keyof IdentityFields,
  string
>

/** A blank draft of the given type. */
export const emptyDraft = (type: ItemPayload['type']): ItemDraft => ({
  type,
  name: '',
  folder: '',
  favorite: false,
  note: '',
  username: '',
  password: '',
  urls: [],
  totpSecret: '',
  identity: EMPTY_IDENTITY,
})

/** The draft that shows an existing item in a form. */
export const draftOf = (payload: ItemPayload): ItemDraft => ({
  type: payload.type,
  name: payload.name,
  folder: payload.folder ?? '',
  favorite: payload.favorite,
  note: payload.note,
  username: payload.login?.username ?? '',
  password: payload.login?.password ?? '',
  urls: payload.login?.urls ?? [],
  totpSecret: payload.login?.totp_secret ?? '',
  identity: Object.fromEntries(
    IDENTITY_KEYS.map((key) => [key, payload.identity?.[key] ?? '']),
  ) as Record<keyof IdentityFields, string>,
})

const cleanUrls = (urls: readonly SavedUrl[]): SavedUrl[] =>
  urls
    .map((entry) => ({ url: normalizeUrl(entry.url) ?? entry.url.trim(), match: entry.match }))
    .filter((entry) => entry.url !== '')

/** The type specific parts of a payload, built from a draft. */
const contentOf = (draft: ItemDraft): Pick<ItemPayload, 'login' | 'identity'> => {
  if (draft.type === 'login') {
    return {
      login: {
        username: draft.username.trim(),
        // The password is kept exactly as typed, spaces included.
        password: draft.password,
        urls: cleanUrls(draft.urls),
        totp_secret: draft.totpSecret.trim() === '' ? null : draft.totpSecret.trim(),
      },
    }
  }
  if (draft.type === 'identity') {
    return {
      identity: Object.fromEntries(
        IDENTITY_KEYS.map((key) => {
          const value = draft.identity[key].trim()
          return [key, value === '' ? null : value]
        }),
      ) as IdentityFields,
    }
  }
  return {}
}

const folderOf = (draft: ItemDraft): string | null =>
  draft.folder.trim() === '' ? null : draft.folder.trim()

/**
 * The payload for a brand new item: first edit (`seq` 1), not trashed.
 * @param deviceId - This device's id, recorded as `edited_by`.
 */
export const newItemPayload = (draft: ItemDraft, deviceId: string, now: Date): ItemPayload => ({
  v: 1,
  seq: 1,
  type: draft.type,
  name: draft.name.trim(),
  folder: folderOf(draft),
  favorite: draft.favorite,
  trashed: false,
  edited_at: now.toISOString(),
  edited_by: deviceId,
  note: draft.note,
  ...contentOf(draft),
})

type History = NonNullable<ItemPayload['password_history']>

/**
 * Pushes a replaced password onto the history, newest first, keeping the 5 newest.
 * Nothing is added when the old value is empty or equals the newest entry.
 * @param replacedAt - The editing device's time, as an ISO string.
 */
export const pushPasswordHistory = (
  history: History | undefined,
  oldPassword: string,
  replacedAt: string,
): History => {
  const current = history ?? []
  if (oldPassword === '' || current[0]?.password === oldPassword) return [...current]
  return [{ password: oldPassword, replaced_at: replacedAt }, ...current].slice(0, 5)
}

/**
 * The next version of an item after an edit. The type never changes. When a login's password
 * changes, the old one goes to the history. `seq` moves past everything this device has seen.
 * @param seenSeq - `seen_seq[item_id]` from the cache.
 */
export const editItemPayload = (
  current: ItemPayload,
  draft: ItemDraft,
  deviceId: string,
  now: Date,
  seenSeq: number | undefined,
): ItemPayload => {
  const content = contentOf({ ...draft, type: current.type })
  const oldPassword = current.login?.password ?? ''
  const passwordChanged = content.login !== undefined && content.login.password !== oldPassword
  const history = passwordChanged
    ? pushPasswordHistory(current.password_history, oldPassword, now.toISOString())
    : current.password_history
  return {
    v: 1,
    seq: nextSeq(seenSeq, current.seq),
    type: current.type,
    name: draft.name.trim(),
    folder: folderOf(draft),
    favorite: draft.favorite,
    trashed: current.trashed,
    edited_at: now.toISOString(),
    edited_by: deviceId,
    note: draft.note,
    ...content,
    ...(history && history.length > 0 ? { password_history: history } : {}),
    ...(current.conflict_copies ? { conflict_copies: current.conflict_copies } : {}),
  }
}

/** The next version of an item with a changed flag (trash, restore, favorite) and nothing else. */
export const patchItemPayload = (
  current: ItemPayload,
  patch: Partial<Pick<ItemPayload, 'trashed' | 'favorite' | 'conflict_copies'>>,
  deviceId: string,
  now: Date,
  seenSeq: number | undefined,
): ItemPayload => {
  const { conflict_copies: copies, ...rest } = { ...current, ...patch }
  return {
    ...rest,
    ...(copies && copies.length > 0 ? { conflict_copies: copies } : {}),
    seq: nextSeq(seenSeq, current.seq),
    edited_at: now.toISOString(),
    edited_by: deviceId,
  }
}
