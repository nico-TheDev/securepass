import { toBase64Url } from '@securepass/crypto'
import { err, ok } from '@securepass/shared'
import { type Cache, openCache, readMeta, writeMeta } from '@securepass/shared/cache'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postLogin, postPrelogin, postSetup } from './api'
import {
  completeSetup,
  type PendingSetup,
  prepareSetup,
  signIn,
  unlockWithPassword,
} from './vault-session'

vi.mock('./api')

const PASSWORD = 'correct horse battery staple 42'
const EMAIL = '  Me@Example.COM '

let cache: Cache
let dbCount = 0

beforeEach(async () => {
  cache = await openCache(`vault-session-${dbCount++}`)
})
afterEach(() => {
  cache.close()
  vi.resetAllMocks()
})

// Argon2id runs once per setup, so share one prepared account across the tests that only read it.
let prepared: PendingSetup
const prepare = async (): Promise<PendingSetup> => {
  if (prepared) return prepared
  const result = await prepareSetup(EMAIL, PASSWORD)
  if (!result.ok) throw new Error('prepareSetup failed')
  prepared = result.value
  return prepared
}

const acceptSetup = () =>
  vi.mocked(postSetup).mockResolvedValue(ok({ token: 'device-token' } as never))

describe('prepareSetup', () => {
  it('lowercases and trims the email in the request', async () => {
    expect((await prepare()).request.email).toBe('me@example.com')
  })

  it('uses Argon2id at or above the KDF floor (covers: AC-3)', async () => {
    const { kdf } = await prepare()
    expect(kdf.alg).toBe('argon2id')
    expect(kdf.m).toBeGreaterThanOrEqual(65536)
    expect(kdf.t).toBeGreaterThanOrEqual(3)
  })

  it('puts no master password or vault key in the request body (covers: AC-2)', async () => {
    const pending = await prepare()
    const body = JSON.stringify(pending.request)
    expect(body).not.toContain(PASSWORD)
    expect(body).not.toContain(toBase64Url(pending.vaultKey))
    expect(Object.keys(pending.request).sort()).toEqual(
      [
        'account_id',
        'auth_key',
        'device_name',
        'email',
        'kdf',
        'kdf_salt',
        'recovery_auth_key',
        'wrapped_vault_key',
        'wrapped_vault_key_recovery',
      ].sort(),
    )
  })

  it('makes a recovery kit with groups of four characters (covers: AC-20)', async () => {
    const { kit } = await prepare()
    expect(kit.groups.length).toBeGreaterThan(1)
    for (const group of kit.groups.slice(0, -1)) expect(group).toHaveLength(4)
    expect(kit.display).toBe(kit.groups.join('-'))
  })
})

describe('completeSetup', () => {
  it('sends the trimmed setup token and saves the account in the cache', async () => {
    acceptSetup()
    const pending = await prepare()

    const result = await completeSetup(cache, pending, '  setup-token ')

    expect(postSetup).toHaveBeenCalledWith('setup-token', pending.request)
    expect(result.ok).toBe(true)
    const meta = await readMeta(cache)
    expect(meta).toMatchObject({
      email: 'me@example.com',
      token: 'device-token',
      device_id: pending.deviceId,
      last_revision: 0,
      seen_seq: {},
    })
    expect(JSON.stringify(meta)).not.toContain(PASSWORD)
  })

  it.each([
    [401, 'bad_token'],
    [409, 'account_exists'],
    [500, 'server'],
  ] as const)('maps a %i reply to %s and saves nothing (covers: AC-1)', async (status, kind) => {
    vi.mocked(postSetup).mockResolvedValue(err({ kind: 'status', status }))

    const result = await completeSetup(cache, await prepare(), 'tok')

    expect(result).toEqual({ ok: false, error: { kind } })
    expect(await readMeta(cache)).toBeUndefined()
  })

  it('maps a network failure to network and saves nothing', async () => {
    vi.mocked(postSetup).mockResolvedValue(err({ kind: 'network' }))
    const result = await completeSetup(cache, await prepare(), 'tok')
    expect(result).toEqual({ ok: false, error: { kind: 'network' } })
    expect(await readMeta(cache)).toBeUndefined()
  })
})

describe('unlockWithPassword', () => {
  const setUp = async () => {
    acceptSetup()
    const session = await completeSetup(cache, await prepare(), 'tok')
    if (!session.ok) throw new Error('setup failed')
    const meta = await readMeta(cache)
    if (!meta) throw new Error('no meta')
    return { meta, vaultKey: session.value.vaultKey }
  }

  it('opens the same vault key that setup made, with no server call (covers: AC-5, AC-10)', async () => {
    const { meta, vaultKey } = await setUp()

    const result = await unlockWithPassword(cache, meta, PASSWORD)

    expect(result.ok && toBase64Url(result.value.vaultKey) === toBase64Url(vaultKey)).toBe(true)
    expect(postLogin).not.toHaveBeenCalled()
    expect(postPrelogin).not.toHaveBeenCalled()
  })

  it('pins the KDF settings after the first successful unlock (covers: AC-3)', async () => {
    const { meta } = await setUp()
    const { pinned_kdf: _unused, ...unpinned } = meta
    await writeMeta(cache, unpinned)

    const result = await unlockWithPassword(cache, unpinned, PASSWORD)

    expect(result.ok && result.value.meta.pinned_kdf).toEqual(meta.kdf)
    expect((await readMeta(cache))?.pinned_kdf).toEqual(meta.kdf)
  })

  it('fails with wrong_password for a wrong password (covers: AC-5)', async () => {
    const { meta } = await setUp()
    expect(await unlockWithPassword(cache, meta, 'not the password')).toEqual({
      ok: false,
      error: { kind: 'wrong_password' },
    })
  })

  it('refuses KDF settings weaker than the floor (covers: AC-3)', async () => {
    const { meta } = await setUp()
    const weak = { ...meta, kdf: { ...meta.kdf, t: 1 }, pinned_kdf: undefined }
    expect(await unlockWithPassword(cache, weak, PASSWORD)).toEqual({
      ok: false,
      error: { kind: 'crypto' },
    })
  })

  it('refuses KDF settings lower than the pinned ones (covers: AC-3)', async () => {
    const { meta } = await setUp()
    const pinnedHigher = { ...meta, pinned_kdf: { ...meta.kdf, t: meta.kdf.t + 1 } }
    expect(await unlockWithPassword(cache, pinnedHigher, PASSWORD)).toEqual({
      ok: false,
      error: { kind: 'crypto' },
    })
  })

  it('fails when the salt was changed (covers: AC-3)', async () => {
    const { meta } = await setUp()
    const result = await unlockWithPassword(
      cache,
      { ...meta, kdf_salt: 'AAAAAAAAAAAAAAAAAAAAAA' },
      PASSWORD,
    )
    expect(result.ok).toBe(false)
  })

  it('fails with crypto when the salt is not valid base64url', async () => {
    const { meta } = await setUp()
    expect(await unlockWithPassword(cache, { ...meta, kdf_salt: '!!!' }, PASSWORD)).toEqual({
      ok: false,
      error: { kind: 'crypto' },
    })
  })
})

describe('signIn', () => {
  /** A fake server that holds what setup sent and answers prelogin and login from it. */
  const serverFrom = (pending: PendingSetup) => {
    const { request } = pending
    vi.mocked(postPrelogin).mockResolvedValue(
      ok({ kdf: request.kdf, kdf_salt: request.kdf_salt } as never),
    )
    vi.mocked(postLogin).mockImplementation(async (login) =>
      login.auth_key === request.auth_key
        ? ok({
            token: 'new-token',
            account_id: request.account_id,
            wrapped_vault_key: request.wrapped_vault_key,
          } as never)
        : err({ kind: 'status', status: 401 }),
    )
  }

  it('derives the keys, opens the same vault key, and saves the account (covers: AC-5)', async () => {
    const pending = await prepare()
    serverFrom(pending)

    const result = await signIn(cache, EMAIL, PASSWORD)

    expect(result.ok && toBase64Url(result.value.vaultKey) === toBase64Url(pending.vaultKey)).toBe(
      true,
    )
    expect(postPrelogin).toHaveBeenCalledWith('me@example.com')
    expect(await readMeta(cache)).toMatchObject({
      email: 'me@example.com',
      token: 'new-token',
      last_revision: 0,
      seen_seq: {},
      pinned_kdf: pending.kdf,
    })
  })

  it('never sends the master password to the server (covers: AC-2)', async () => {
    serverFrom(await prepare())
    await signIn(cache, EMAIL, PASSWORD)
    const sent = JSON.stringify([
      vi.mocked(postPrelogin).mock.calls,
      vi.mocked(postLogin).mock.calls,
    ])
    expect(sent).not.toContain(PASSWORD)
  })

  it('returns wrong_credentials on a 401 and saves nothing', async () => {
    serverFrom(await prepare())
    const result = await signIn(cache, EMAIL, 'wrong password entirely')
    expect(result).toEqual({ ok: false, error: { kind: 'wrong_credentials' } })
    expect(await readMeta(cache)).toBeUndefined()
  })

  it('returns server for a 429 from login', async () => {
    serverFrom(await prepare())
    vi.mocked(postLogin).mockResolvedValue(err({ kind: 'status', status: 429 }))
    expect(await signIn(cache, EMAIL, PASSWORD)).toEqual({ ok: false, error: { kind: 'server' } })
  })

  it('returns network when prelogin cannot reach the server', async () => {
    vi.mocked(postPrelogin).mockResolvedValue(err({ kind: 'network' }))
    expect(await signIn(cache, EMAIL, PASSWORD)).toEqual({ ok: false, error: { kind: 'network' } })
    expect(postLogin).not.toHaveBeenCalled()
  })

  it('returns server when prelogin fails with a status', async () => {
    vi.mocked(postPrelogin).mockResolvedValue(err({ kind: 'status', status: 500 }))
    expect(await signIn(cache, EMAIL, PASSWORD)).toEqual({ ok: false, error: { kind: 'server' } })
  })

  it('returns network when login cannot reach the server', async () => {
    serverFrom(await prepare())
    vi.mocked(postLogin).mockResolvedValue(err({ kind: 'network' }))
    expect(await signIn(cache, EMAIL, PASSWORD)).toEqual({ ok: false, error: { kind: 'network' } })
  })

  it('refuses KDF settings below the floor from a hostile server and never calls login (covers: AC-3)', async () => {
    vi.mocked(postPrelogin).mockResolvedValue(
      ok({
        kdf: { alg: 'argon2id', m: 1024, t: 1, p: 1 },
        kdf_salt: 'c2FsdHNhbHRzYWx0cw',
      } as never),
    )
    expect(await signIn(cache, EMAIL, PASSWORD)).toEqual({ ok: false, error: { kind: 'crypto' } })
    expect(postLogin).not.toHaveBeenCalled()
  })

  it('refuses a salt that is not valid base64url', async () => {
    const { request } = await prepare()
    vi.mocked(postPrelogin).mockResolvedValue(ok({ kdf: request.kdf, kdf_salt: '***' } as never))
    expect(await signIn(cache, EMAIL, PASSWORD)).toEqual({ ok: false, error: { kind: 'crypto' } })
  })

  it('returns crypto when the server hands back a vault key that does not open', async () => {
    const pending = await prepare()
    serverFrom(pending)
    vi.mocked(postLogin).mockResolvedValue(
      ok({
        token: 't',
        account_id: 'someone-else',
        wrapped_vault_key: pending.request.wrapped_vault_key,
      } as never),
    )
    expect(await signIn(cache, EMAIL, PASSWORD)).toEqual({ ok: false, error: { kind: 'crypto' } })
    expect(await readMeta(cache)).toBeUndefined()
  })
})
