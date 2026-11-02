import type { ItemPayload } from '@securepass/shared'
import { argon2id } from 'hash-wasm'
import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './bytes'
import { open, seal } from './envelope'
import { openItem, sealItem } from './item'
import { assertKdf, deriveMasterKey, KDF_FLOOR } from './kdf'
import { hkdf, newAccountId, newVaultKey, splitKeys } from './keys'
import { unwrapVaultKey, wrapVaultKey } from './vault-key'

const hex = (bytes: Uint8Array): string =>
  [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
const floor = { alg: 'argon2id', ...KDF_FLOOR } as const
const payload: ItemPayload = {
  v: 1,
  seq: 1,
  type: 'login',
  name: 'Example',
  folder: null,
  favorite: false,
  trashed: false,
  edited_at: '2026-11-02T10:00:00.000Z',
  edited_by: 'device-1',
  login: {
    username: 'me',
    password: 'hunter2',
    urls: [{ url: 'https://example.com', match: 'domain' }],
    totp_secret: null,
  },
  note: '',
}

describe('known answer vectors', () => {
  // hash-wasm has no associated data input, so the full RFC 9106 section 5.3 vector (which uses it)
  // cannot be reproduced. This is the argon2id vector from the Argon2 reference implementation instead.
  it('argon2id matches the Argon2 reference vector (v1.3, t=2, m=65536, p=1)', async () => {
    const tag = await argon2id({
      password: 'password',
      salt: 'somesalt',
      parallelism: 1,
      iterations: 2,
      memorySize: 65536,
      hashLength: 32,
      outputType: 'hex',
    })
    expect(tag).toBe('09316115d5cf24ed5a15a31a3ba326e5cf32edc24702987c02b6566f61913cf7')
  })

  it('hkdf matches RFC 5869 test case 3 (no salt, empty info)', async () => {
    const okm = await hkdf(new Uint8Array(22).fill(0x0b), '')
    expect(hex(okm)).toBe('8da4e775a563c18f715f802a063c5a31b8a11f5c5ee1879ec3454e5f3c738d2d')
  })
})

describe('assertKdf', () => {
  it('accepts the floor and refuses other algorithms', () => {
    expect(assertKdf(floor).ok).toBe(true)
    const bad = assertKdf({ ...floor, alg: 'pbkdf2' })
    expect(!bad.ok && bad.error.kind).toBe('UnsupportedKdf')
  })
  it('refuses weak, huge, and downgraded settings', () => {
    const weak = assertKdf({ ...floor, m: 19456 })
    expect(!weak.ok && weak.error.kind).toBe('WeakKdf')
    const huge = assertKdf({ ...floor, m: 4194304 })
    expect(!huge.ok && huge.error.kind).toBe('KdfOutOfRange')
    const down = assertKdf(floor, { ...floor, t: 4 })
    expect(!down.ok && down.error.kind).toBe('KdfDowngrade')
    expect(assertKdf({ ...floor, t: 5 }, floor).ok).toBe(true)
  })
})

describe('envelope', () => {
  const key = newVaultKey()
  it('round trips and fails on any changed byte, wrong ad, or wrong version', () => {
    const sealed = seal(key, new Uint8Array([1, 2, 3]), 'item|a')
    const opened = open(key, sealed, 'item|a')
    expect(opened.ok && [...opened.value]).toEqual([1, 2, 3])
    expect(open(key, sealed, 'item|b').ok).toBe(false)
    for (let i = 0; i < sealed.length; i++) {
      const copy = sealed.slice()
      copy[i] = (copy[i] ?? 0) ^ 1
      expect(open(key, copy, 'item|a').ok).toBe(false)
    }
  })
  it('uses a fresh nonce every time', () => {
    const a = seal(key, new Uint8Array(1), 'x')
    const b = seal(key, new Uint8Array(1), 'x')
    expect(toBase64Url(a)).not.toBe(toBase64Url(b))
  })
})

describe('vault key and items', () => {
  it('derives, wraps, unwraps, and opens an item; wrong password and changed salt fail', async () => {
    const salt = crypto.getRandomValues(new Uint8Array(16))
    const accountId = newAccountId()
    const started = performance.now()
    const master = await deriveMasterKey({ password: 'correct horse', kdf: floor, kdfSalt: salt })
    expect(performance.now() - started).toBeLessThan(2000)
    if (!master.ok) throw new Error('derive failed')
    const { enc_key, auth_key } = await splitKeys(master.value)
    expect(hex(enc_key)).not.toBe(hex(auth_key))

    const vaultKey = newVaultKey()
    const wrapped = await wrapVaultKey(enc_key, vaultKey, accountId, floor, salt)
    const back = await unwrapVaultKey(enc_key, wrapped, accountId, floor, salt)
    expect(back.ok && hex(back.value)).toBe(hex(vaultKey))

    const otherSalt = crypto.getRandomValues(new Uint8Array(16))
    expect((await unwrapVaultKey(enc_key, wrapped, accountId, floor, otherSalt)).ok).toBe(false)
    expect((await unwrapVaultKey(enc_key, wrapped, accountId, { ...floor, t: 4 }, salt)).ok).toBe(
      false,
    )
    const wrong = await deriveMasterKey({ password: 'wrong', kdf: floor, kdfSalt: salt })
    if (!wrong.ok) throw new Error('derive failed')
    expect(
      (
        await unwrapVaultKey(
          (
            await splitKeys(wrong.value)
          ).enc_key,
          wrapped,
          accountId,
          floor,
          salt,
        )
      ).ok,
    ).toBe(false)

    const id = crypto.randomUUID()
    const sealed = await sealItem(vaultKey, id, payload)
    if (!sealed.ok) throw new Error('seal failed')
    const opened = await openItem(vaultKey, id, sealed.value)
    expect(opened.ok && opened.value.name).toBe('Example')
    const moved = await openItem(vaultKey, crypto.randomUUID(), sealed.value)
    expect(!moved.ok && moved.error.kind).toBe('Damaged')
    const flipped = fromBase64Url(sealed.value.payload) ?? new Uint8Array()
    flipped[30] = (flipped[30] ?? 0) ^ 1
    const damaged = await openItem(vaultKey, id, { ...sealed.value, payload: toBase64Url(flipped) })
    expect(!damaged.ok && damaged.error.kind).toBe('Damaged')
  }, 20000)

  it('refuses an item over 64 KiB', async () => {
    const big = await sealItem(newVaultKey(), crypto.randomUUID(), {
      ...payload,
      note: 'x'.repeat(70000),
    })
    expect(!big.ok && big.error.kind).toBe('ItemTooLarge')
  })
})
