import { newVaultKey, openItem, sealItem } from '@securepass/crypto'
import type { ItemPayload, SyncItem } from '@securepass/shared'
import {
  type Cache,
  type CacheMeta,
  openCache,
  readItems,
  readMeta,
  readPending,
  writeMeta,
} from '@securepass/shared/cache'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { syncVault } from './engine'
import { createItem, loadVaultItems, patchItem, updateItem } from './items'
import { draftOf, emptyDraft } from './payload'

/** A tiny in memory stand in for the sync server: revisions, `If-Match`, and 409 with the row. */
const fakeServer = () => {
  const rows = new Map<string, SyncItem>()
  let revision = 0
  let status: number | null = null
  let fullResync = false
  const requests: { method: string; url: string; body: string | null }[] = []
  const json = (body: unknown, code = 200) =>
    new Response(JSON.stringify(body), {
      status: code,
      headers: { 'Content-Type': 'application/json' },
    })
  const fetcher = (async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = String(input)
    const method = init.method ?? 'GET'
    requests.push({ method, url, body: typeof init.body === 'string' ? init.body : null })
    if (status === 0) throw new Error('offline')
    if (status === 401) return json({ error: 'unauthorized', code: 'expired' }, 401)
    if (method === 'PUT') {
      const id = url.split('/').at(-1) ?? ''
      const base = Number(new Headers(init.headers).get('If-Match'))
      const current = rows.get(id)
      if ((current?.revision ?? 0) !== base)
        return json({ error: 'conflict', current: current ?? null }, 409)
      const body = JSON.parse(String(init.body)) as { ciphertext: string; trashed: boolean }
      revision += 1
      const now = Math.floor(Date.now() / 1000)
      rows.set(id, {
        id,
        revision,
        ciphertext: body.ciphertext,
        created_at: current?.created_at ?? now,
        updated_at: now,
        deleted_at: body.trashed ? now : null,
        purged: false,
      })
      return json({ revision, updated_at: now, purge_after: null })
    }
    const since = Number(new URL(url, 'http://x').searchParams.get('since'))
    const items = [...rows.values()].filter((row) => fullResync || row.revision > since)
    return json({ items, revision, full_resync: fullResync })
  }) as typeof fetch
  return {
    fetcher,
    rows,
    requests,
    /** Writes a row as another device would. */
    put: (id: string, ciphertext: string | null, updatedAt = Math.floor(Date.now() / 1000)) => {
      revision += 1
      rows.set(id, {
        id,
        revision,
        ciphertext,
        created_at: updatedAt,
        updated_at: updatedAt,
        deleted_at: null,
        purged: ciphertext === null,
      })
    },
    drop: (id: string) => rows.delete(id),
    setStatus: (next: number | null) => {
      status = next
    },
    setFullResync: (next: boolean) => {
      fullResync = next
    },
  }
}

const meta = (deviceId: string): CacheMeta => ({
  account_id: 'acc',
  email: 'me@example.com',
  kdf: { alg: 'argon2id', m: 65536, t: 3, p: 1 },
  kdf_salt: 'c2FsdA',
  wrapped_vault_key: 'wrapped',
  last_revision: 0,
  token: 'tok',
  device_id: deviceId,
  seen_seq: {},
})

const loginDraft = (name: string, password: string) => ({
  ...emptyDraft('login'),
  name,
  username: 'me',
  password,
})

let vaultKey: Uint8Array
let a: Cache
let b: Cache
let count = 0
const names = async (cache: Cache) =>
  (await loadVaultItems(cache, vaultKey)).map((item) =>
    item.kind === 'item' ? item.payload.name : 'damaged',
  )
const only = async (cache: Cache) => {
  const item = (await loadVaultItems(cache, vaultKey))[0]
  if (item?.kind !== 'item') throw new Error('expected one open item')
  return item
}

beforeEach(async () => {
  vaultKey = newVaultKey()
  a = await openCache(`engine-a-${count}`)
  b = await openCache(`engine-b-${count++}`)
  await writeMeta(a, meta('device-a'))
  await writeMeta(b, meta('device-b'))
})
afterEach(() => {
  a.close()
  b.close()
})

describe('syncVault', () => {
  it('a change saved on one device appears on another after its next sync (AC-8)', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw'))
    expect((await only(a)).pending).toBe(true)
    const pushed = await syncVault(a, vaultKey, '', server.fetcher)
    expect(pushed.ok && pushed.value.pushed).toBe(1)
    expect((await only(a)).pending).toBe(false)

    await syncVault(b, vaultKey, '', server.fetcher)
    expect(await names(b)).toEqual(['Example'])
    expect((await readMeta(b))?.seen_seq[(await only(b)).id]).toBe(1)
    // The server only ever saw ciphertext.
    expect(JSON.stringify(server.requests)).not.toContain('Example')
  })

  it('edits made offline queue up and reach the server once back online (AC-10)', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw-1'))
    await syncVault(a, vaultKey, '', server.fetcher)
    const { id } = await only(a)

    server.setStatus(0)
    await updateItem(a, vaultKey, id, { ...draftOf((await only(a)).payload), password: 'pw-2' })
    await updateItem(a, vaultKey, id, { ...draftOf((await only(a)).payload), password: 'pw-3' })
    const offline = await syncVault(a, vaultKey, '', server.fetcher)
    expect(offline).toEqual({ ok: false, error: { kind: 'network' } })
    // Two edits to one item wait as one write, based on the last revision the server held.
    expect(await readPending(a)).toHaveLength(1)
    expect((await only(a)).payload.login?.password).toBe('pw-3')

    server.setStatus(null)
    expect((await syncVault(a, vaultKey, '', server.fetcher)).ok).toBe(true)
    expect(await readPending(a)).toHaveLength(0)
    await syncVault(b, vaultKey, '', server.fetcher)
    const onB = await only(b)
    expect(onB.payload.login?.password).toBe('pw-3')
    expect(onB.payload.password_history?.map((entry) => entry.password)).toEqual(['pw-2', 'pw-1'])
    expect(onB.payload.conflict_copies).toBeUndefined()
  })

  it('two devices edit the same item: the newer wins and the loser is kept (AC-9, AC-12)', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'original'))
    await syncVault(a, vaultKey, '', server.fetcher)
    await syncVault(b, vaultKey, '', server.fetcher)
    const { id } = await only(a)

    const early = new Date(Date.now() - 60_000)
    const late = new Date(Date.now() - 30_000)
    await updateItem(
      a,
      vaultKey,
      id,
      { ...draftOf((await only(a)).payload), name: 'From A', password: 'pw-a' },
      early,
    )
    await updateItem(
      b,
      vaultKey,
      id,
      { ...draftOf((await only(b)).payload), name: 'From B', password: 'pw-b' },
      late,
    )

    await syncVault(a, vaultKey, '', server.fetcher)
    const merged = await syncVault(b, vaultKey, '', server.fetcher)
    expect(merged.ok).toBe(true)
    expect(await readPending(b)).toHaveLength(0)

    await syncVault(a, vaultKey, '', server.fetcher)
    for (const cache of [a, b]) {
      const item = await only(cache)
      expect(item.payload.name).toBe('From B')
      expect(item.payload.login?.password).toBe('pw-b')
      expect(item.payload.conflict_copies?.map((copy) => copy.payload.name)).toEqual(['From A'])
      expect(item.payload.conflict_copies?.[0]?.payload.login?.password).toBe('pw-a')
      expect(item.payload.password_history?.map((entry) => entry.password)).toEqual([
        'pw-a',
        'original',
      ])
      expect(item.rolledBack).toBe(false)
    }
  })

  it('an older queued edit loses to the server copy but is still kept as a copy', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'original'))
    await syncVault(a, vaultKey, '', server.fetcher)
    await syncVault(b, vaultKey, '', server.fetcher)
    const { id } = await only(a)
    await updateItem(
      b,
      vaultKey,
      id,
      { ...draftOf((await only(b)).payload), name: 'Stale B' },
      new Date(Date.now() - 120_000),
    )
    await updateItem(
      a,
      vaultKey,
      id,
      { ...draftOf((await only(a)).payload), name: 'Fresh A' },
      new Date(Date.now() - 10_000),
    )
    await syncVault(a, vaultKey, '', server.fetcher)
    await syncVault(b, vaultKey, '', server.fetcher)
    const item = await only(b)
    expect(item.payload.name).toBe('Fresh A')
    expect(item.payload.conflict_copies?.map((copy) => copy.payload.name)).toEqual(['Stale B'])
  })

  it('trash on one device hides the item on the other, and restore brings it back (AC-11)', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw'))
    await syncVault(a, vaultKey, '', server.fetcher)
    const { id } = await only(a)
    await patchItem(a, vaultKey, id, { trashed: true })
    await syncVault(a, vaultKey, '', server.fetcher)
    expect(
      JSON.parse(server.requests.findLast((request) => request.method === 'PUT')?.body ?? '{}')
        .trashed,
    ).toBe(true)
    await syncVault(b, vaultKey, '', server.fetcher)
    expect((await only(b)).payload.trashed).toBe(true)
    await patchItem(b, vaultKey, id, { trashed: false })
    await syncVault(b, vaultKey, '', server.fetcher)
    await syncVault(a, vaultKey, '', server.fetcher)
    expect((await only(a)).payload.trashed).toBe(false)
  })

  it("a purged item disappears from the other device's cache (AC-11)", async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw'))
    await syncVault(a, vaultKey, '', server.fetcher)
    await syncVault(b, vaultKey, '', server.fetcher)
    const { id } = await only(b)
    server.put(id, null)
    await syncVault(b, vaultKey, '', server.fetcher)
    expect(await readItems(b)).toEqual([])
    // A write queued for a purged item is dropped instead of bringing it back.
    await updateItem(a, vaultKey, id, { ...draftOf((await only(a)).payload), name: 'Too late' })
    await syncVault(a, vaultKey, '', server.fetcher)
    expect(await readPending(a)).toHaveLength(0)
    expect(await readItems(a)).toEqual([])
  })

  it('flags a server that sends back an older version and keeps the cached copy (AC-6)', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw-1'))
    await syncVault(a, vaultKey, '', server.fetcher)
    const first = await only(a)
    const oldCiphertext = server.rows.get(first.id)?.ciphertext ?? ''
    await updateItem(a, vaultKey, first.id, { ...draftOf(first.payload), password: 'pw-2' })
    await syncVault(a, vaultKey, '', server.fetcher)

    // A hostile server hands the old version back under a new revision.
    server.put(first.id, oldCiphertext)
    const round = await syncVault(a, vaultKey, '', server.fetcher)
    expect(round.ok && round.value.rejected).toEqual([first.id])
    const kept = await only(a)
    expect(kept.payload.login?.password).toBe('pw-2')
    expect(kept.rolledBack).toBe(true)
    expect((await readMeta(a))?.flagged_rollbacks).toEqual([first.id])
  })

  it('shows a tampered row as damaged, never as garbled data (AC-6)', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw'))
    await syncVault(a, vaultKey, '', server.fetcher)
    const { id } = await only(a)
    const moved = await sealItem(vaultKey, crypto.randomUUID(), (await only(a)).payload)
    server.put(id, moved.ok ? moved.value : '')
    await syncVault(a, vaultKey, '', server.fetcher)
    expect(await loadVaultItems(a, vaultKey)).toEqual([{ kind: 'damaged', id }])
  })

  it('an expired session keeps the cache and the queued edits (AC-22)', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw'))
    server.setStatus(401)
    const result = await syncVault(a, vaultKey, '', server.fetcher)
    expect(result).toEqual({ ok: false, error: { kind: 'unauthorized', code: 'expired' } })
    expect(await readPending(a)).toHaveLength(1)
    expect(await names(a)).toEqual(['Example'])
    server.setStatus(null)
    expect((await syncVault(a, vaultKey, '', server.fetcher)).ok).toBe(true)
    expect(server.rows.size).toBe(1)
  })

  it('a full resync drops items the server no longer lists and keeps queued writes', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Stays', 'pw'))
    await createItem(a, vaultKey, loginDraft('Ghost', 'pw'))
    await syncVault(a, vaultKey, '', server.fetcher)
    const ghost = (await loadVaultItems(a, vaultKey)).find(
      (item) => item.kind === 'item' && item.payload.name === 'Ghost',
    )
    server.drop(ghost?.id ?? '')
    await createItem(a, vaultKey, loginDraft('Queued', 'pw'))
    server.setFullResync(true)
    const round = await syncVault(a, vaultKey, '', server.fetcher)
    expect(round.ok && round.value.fullResync).toBe(true)
    expect((await names(a)).toSorted()).toEqual(['Queued', 'Stays'])
  })

  it('seals every write under the item id, so the server cannot move it', async () => {
    const server = fakeServer()
    await createItem(a, vaultKey, loginDraft('Example', 'pw'))
    await syncVault(a, vaultKey, '', server.fetcher)
    const [row] = [...server.rows.values()]
    const opened = await openItem(vaultKey, row?.id ?? '', row?.ciphertext ?? '')
    expect(opened.ok && (opened.value as ItemPayload).name).toBe('Example')
    expect((await openItem(vaultKey, crypto.randomUUID(), row?.ciphertext ?? '')).ok).toBe(false)
  })
})
