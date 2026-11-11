import { newVaultKey, sealItem } from '@securepass/crypto'
import {
  applySyncPage,
  type Cache,
  type CacheMeta,
  openCache,
  queueOp,
  readMeta,
  readPending,
  writeMeta,
} from '@securepass/shared/cache'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  createLogin,
  type LoginDraft,
  listedItems,
  loadVaultItems,
  newLoginPayload,
  type VaultItem,
} from './vault-items'

const draft: LoginDraft = {
  name: '  Example  ',
  username: '  me@example.com ',
  password: ' keep spaces ',
  url: ' https://example.com/login ',
  note: 'a note',
}
const now = new Date('2026-11-03T10:00:00Z')

const baseMeta = (overrides: Partial<CacheMeta> = {}): CacheMeta => ({
  account_id: 'acc',
  email: 'me@example.com',
  kdf: { alg: 'argon2id', m: 65536, t: 3, p: 1 },
  kdf_salt: 'c2FsdA',
  wrapped_vault_key: 'wrapped',
  last_revision: 0,
  token: 'tok',
  device_id: 'device-1',
  seen_seq: {},
  ...overrides,
})

let cache: Cache
let vaultKey: Uint8Array
let dbCount = 0

beforeEach(async () => {
  cache = await openCache(`vault-items-${dbCount++}`)
  vaultKey = newVaultKey()
})
afterEach(() => cache.close())

describe('newLoginPayload', () => {
  it('trims name, username, and url but keeps the password exactly as typed', () => {
    const payload = newLoginPayload(draft, 'device-1', now)
    expect(payload.name).toBe('Example')
    expect(payload.login?.username).toBe('me@example.com')
    expect(payload.login?.password).toBe(' keep spaces ')
    expect(payload.login?.urls).toEqual([{ url: 'https://example.com/login', match: 'domain' }])
  })

  it('starts at seq 1, not trashed, with no folder, stamped with the device and time', () => {
    const payload = newLoginPayload(draft, 'device-1', now)
    expect(payload).toMatchObject({
      v: 1,
      seq: 1,
      type: 'login',
      trashed: false,
      folder: null,
      edited_by: 'device-1',
      edited_at: '2026-11-03T10:00:00.000Z',
    })
  })

  it('leaves urls empty when the website is blank', () => {
    expect(newLoginPayload({ ...draft, url: '   ' }, 'd', now).login?.urls).toEqual([])
  })
})

describe('createLogin', () => {
  it('queues a sealed put and records seq 1 in seen_seq (covers: AC-7)', async () => {
    await writeMeta(cache, baseMeta())

    const result = await createLogin(cache, vaultKey, draft, now)

    expect(result.ok).toBe(true)
    const pending = await readPending(cache)
    expect(pending).toHaveLength(1)
    const op = pending[0]
    expect(op).toMatchObject({ op: 'put', base_revision: 0, trashed: false })
    expect(result.ok && result.value.seen_seq[op?.id ?? '']).toBe(1)
    expect((await readMeta(cache))?.seen_seq[op?.id ?? '']).toBe(1)
  })

  it('never stores plaintext fields in the queued op (covers: AC-2)', async () => {
    await writeMeta(cache, baseMeta())
    await createLogin(cache, vaultKey, draft, now)
    const serialized = JSON.stringify(await readPending(cache))
    expect(serialized).not.toContain('keep spaces')
    expect(serialized).not.toContain('Example')
    expect(serialized).not.toContain('me@example.com')
  })

  it('rejects an empty name and queues nothing', async () => {
    await writeMeta(cache, baseMeta())
    const result = await createLogin(cache, vaultKey, { ...draft, name: '   ' }, now)
    expect(result).toEqual({ ok: false, error: { kind: 'invalid' } })
    expect(await readPending(cache)).toHaveLength(0)
  })

  it('rejects when the device has no account record', async () => {
    const result = await createLogin(cache, vaultKey, draft, now)
    expect(result).toEqual({ ok: false, error: { kind: 'invalid' } })
  })
})

describe('loadVaultItems', () => {
  it('shows a freshly created login at once, marked as not synced', async () => {
    await writeMeta(cache, baseMeta())
    await createLogin(cache, vaultKey, draft, now)

    const items = await loadVaultItems(cache, vaultKey)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ kind: 'item', pending: true, revision: 0 })
    expect(items[0]?.kind === 'item' && items[0].payload.name).toBe('Example')
  })

  it('opens server rows and marks them as synced with their revision', async () => {
    await writeMeta(cache, baseMeta())
    const payload = newLoginPayload(draft, 'device-1', now)
    const sealed = await sealItem(vaultKey, 'item-1', payload)
    if (!sealed.ok) throw new Error('seal failed')
    await applySyncPage(
      cache,
      [
        {
          id: 'item-1',
          revision: 4,
          ciphertext: sealed.value,
          trashed: false,
          purged: false,
        } as never,
      ],
      4,
    )

    const items = await loadVaultItems(cache, vaultKey)

    expect(items[0]).toMatchObject({ kind: 'item', id: 'item-1', revision: 4, pending: false })
  })

  it('shows an item as damaged when its ciphertext fails the tamper check (covers: AC-6)', async () => {
    await writeMeta(cache, baseMeta())
    const sealed = await sealItem(vaultKey, 'item-1', newLoginPayload(draft, 'd', now))
    if (!sealed.ok) throw new Error('seal failed')
    await applySyncPage(
      cache,
      [
        {
          id: 'item-1',
          revision: 1,
          ciphertext: sealed.value,
          trashed: false,
          purged: false,
        } as never,
      ],
      1,
    )

    // The same ciphertext moved to another id must not open.
    const moved = await sealItem(vaultKey, 'other-id', newLoginPayload(draft, 'd', now))
    if (!moved.ok) throw new Error('seal failed')
    await queueOp(cache, {
      op: 'put',
      id: 'item-1',
      base_revision: 1,
      ciphertext: moved.value,
      trashed: false,
      queued_at: 1,
    })

    expect(await loadVaultItems(cache, vaultKey)).toEqual([{ kind: 'damaged', id: 'item-1' }])
  })

  it('shows every item as damaged when opened with the wrong vault key', async () => {
    await writeMeta(cache, baseMeta())
    await createLogin(cache, vaultKey, draft, now)
    const items = await loadVaultItems(cache, newVaultKey())
    expect(items.map((item) => item.kind)).toEqual(['damaged'])
  })

  it('returns an empty list for an empty cache', async () => {
    expect(await loadVaultItems(cache, vaultKey)).toEqual([])
  })
})

describe('listedItems', () => {
  const item = (id: string, name: string, trashed = false): VaultItem => ({
    kind: 'item',
    id,
    revision: 1,
    pending: false,
    payload: { ...newLoginPayload({ ...draft, name }, 'd', now), trashed },
  })

  it('hides trashed items', () => {
    const listed = listedItems([item('a', 'Keep'), item('b', 'Gone', true)])
    expect(listed.map((entry) => entry.id)).toEqual(['a'])
  })

  it('sorts by name ignoring case', () => {
    const listed = listedItems([item('1', 'banana'), item('2', 'Apple'), item('3', 'cherry')])
    expect(listed.map((entry) => entry.id)).toEqual(['2', '1', '3'])
  })

  it('keeps damaged items visible so the user sees something is wrong', () => {
    const listed = listedItems([{ kind: 'damaged', id: 'x' }, item('a', 'Apple')])
    expect(listed.map((entry) => entry.id).sort()).toEqual(['a', 'x'])
  })

  it('does not change the input array', () => {
    const input = [item('1', 'b'), item('2', 'a')]
    listedItems(input)
    expect(input.map((entry) => entry.id)).toEqual(['1', '2'])
  })
})
