import { describe, expect, it } from 'vitest'
import { fromBase64Url, toBase64Url } from './bytes'
import { assertKdf, deriveMasterKey, KDF_CEILING, KDF_FLOOR } from './kdf'
import { newAccountId, newVaultKey } from './keys'
import { unwrapWithPin, wrapWithPin } from './pin'
import { newRecoveryKit, parseRecoveryKey, unwrapVaultKeyRecovery } from './recovery'
import { isRollback, nextSeq } from './rollback'
import { wrapVaultKeyRecovery } from './vault-key'

const floor = { alg: 'argon2id', ...KDF_FLOOR } as const

describe('rollback check (AC-6)', () => {
  it('flags a seq lower than the one already seen', () => {
    expect(isRollback(2, 3)).toBe(true)
  })
  it('accepts the same or a newer seq, and any seq for an unseen item', () => {
    expect(isRollback(3, 3)).toBe(false)
    expect(isRollback(4, 3)).toBe(false)
    expect(isRollback(1, undefined)).toBe(false)
  })
  it('next seq is one more than the highest value seen', () => {
    expect(nextSeq(undefined, undefined)).toBe(1)
    expect(nextSeq(5, 3)).toBe(6)
    expect(nextSeq(2, 7)).toBe(8)
  })
})

describe('recovery kit (AC-20)', () => {
  it('a typed recovery key unwraps the same vault key the password path holds', async () => {
    const kit = await newRecoveryKit()
    const accountId = newAccountId()
    const vaultKey = newVaultKey()
    const wrapped = wrapVaultKeyRecovery(kit.recovery_enc_key, vaultKey, accountId)

    const typed = await parseRecoveryKey(` ${kit.display.toLowerCase().replaceAll('-', ' ')} `)
    if (!typed.ok) throw new Error('parse failed')
    expect(typed.value.recovery_auth_key).toEqual(kit.recovery_auth_key)
    const opened = unwrapVaultKeyRecovery(typed.value.recovery_enc_key, wrapped, accountId)
    expect(opened.ok && opened.value).toEqual(vaultKey)
  })

  it('refuses another account id, another kit, and a changed byte', async () => {
    const kit = await newRecoveryKit()
    const other = await newRecoveryKit()
    const accountId = newAccountId()
    const wrapped = wrapVaultKeyRecovery(kit.recovery_enc_key, newVaultKey(), accountId)
    expect(unwrapVaultKeyRecovery(kit.recovery_enc_key, wrapped, newAccountId()).ok).toBe(false)
    expect(unwrapVaultKeyRecovery(other.recovery_enc_key, wrapped, accountId).ok).toBe(false)
    const bytes = fromBase64Url(wrapped) ?? new Uint8Array()
    bytes[30] = (bytes[30] ?? 0) ^ 1
    expect(unwrapVaultKeyRecovery(kit.recovery_enc_key, toBase64Url(bytes), accountId).ok).toBe(
      false,
    )
  })

  it('refuses a key that is too short, has a bad character, or is not canonical', async () => {
    const kit = await newRecoveryKit()
    expect((await parseRecoveryKey(kit.display.slice(0, -1))).ok).toBe(false)
    expect((await parseRecoveryKey(`${kit.display.slice(0, -1)}1`)).ok).toBe(false)
    expect((await parseRecoveryKey('')).ok).toBe(false)
  })
})

describe('PIN wrap (AC-13)', () => {
  it('wraps and unwraps with a 6 character PIN, bound to the device id', async () => {
    const vaultKey = newVaultKey()
    const wrap = await wrapWithPin('abc123', vaultKey, 'device-1')
    if (!wrap.ok) throw new Error('wrap failed')
    const opened = await unwrapWithPin('abc123', wrap.value, 'device-1')
    expect(opened.ok && opened.value).toEqual(vaultKey)
    const wrongPin = await unwrapWithPin('abc124', wrap.value, 'device-1')
    expect(!wrongPin.ok && wrongPin.error.kind).toBe('Damaged')
    const wrongDevice = await unwrapWithPin('abc123', wrap.value, 'device-2')
    expect(!wrongDevice.ok && wrongDevice.error.kind).toBe('Damaged')
  }, 30000)

  it('refuses a 5 character PIN', async () => {
    const wrap = await wrapWithPin('12345', newVaultKey(), 'device-1')
    expect(!wrap.ok && wrap.error.kind).toBe('InvalidInput')
  })
})

describe('KDF range suite (AC-3)', () => {
  const cases: readonly [string, object, string | true][] = [
    ['floor', floor, true],
    ['ceiling', { alg: 'argon2id', ...KDF_CEILING }, true],
    ['m below floor', { ...floor, m: KDF_FLOOR.m - 1 }, 'WeakKdf'],
    ['t below floor', { ...floor, t: 2 }, 'WeakKdf'],
    ['p below floor', { ...floor, p: 0 }, 'WeakKdf'],
    ['m above ceiling', { ...floor, m: KDF_CEILING.m + 1 }, 'KdfOutOfRange'],
    ['t above ceiling', { ...floor, t: 11 }, 'KdfOutOfRange'],
    ['p above ceiling', { ...floor, p: 5 }, 'KdfOutOfRange'],
    ['fractional m', { ...floor, m: 65536.5 }, 'KdfOutOfRange'],
    ['argon2i', { ...floor, alg: 'argon2i' }, 'UnsupportedKdf'],
    ['missing alg', { m: 65536, t: 3, p: 1 }, 'UnsupportedKdf'],
  ]
  it.each(cases)('%s', (_name, kdf, expected) => {
    const result = assertKdf(kdf)
    expect(result.ok ? true : result.error.kind).toBe(expected)
  })

  it('refuses a value lower than the pinned one in any single parameter', () => {
    const pinned = { alg: 'argon2id', m: 131072, t: 4, p: 2 } as const
    for (const lower of [{ m: 65536 }, { t: 3 }, { p: 1 }]) {
      const result = assertKdf({ ...pinned, ...lower }, pinned)
      expect(!result.ok && result.error.kind).toBe('KdfDowngrade')
    }
    expect(assertKdf(pinned, pinned).ok).toBe(true)
  })

  it('never derives with refused settings or a salt of the wrong length', async () => {
    const weak = await deriveMasterKey({
      password: 'x',
      kdf: { ...floor, m: 19456 },
      kdfSalt: new Uint8Array(16),
    })
    expect(!weak.ok && weak.error.kind).toBe('WeakKdf')
    const salt = await deriveMasterKey({ password: 'x', kdf: floor, kdfSalt: new Uint8Array(8) })
    expect(!salt.ok && salt.error.kind).toBe('InvalidInput')
  })
})

describe('unlock benchmark (AC-5, recorded not gated)', () => {
  it('records how long a derivation at the floor takes', async () => {
    const started = performance.now()
    const master = await deriveMasterKey({
      password: 'correct horse battery staple',
      kdf: floor,
      kdfSalt: new Uint8Array(16).fill(7),
    })
    const elapsed = Math.round(performance.now() - started)
    console.info(`Argon2id at the floor (m=65536, t=3, p=1): ${elapsed} ms`)
    expect(master.ok).toBe(true)
  }, 30000)

  it('normalizes the password to NFC before deriving', async () => {
    const salt = new Uint8Array(16).fill(9)
    const composed = await deriveMasterKey({ password: 'café', kdf: floor, kdfSalt: salt })
    const decomposed = await deriveMasterKey({ password: 'café', kdf: floor, kdfSalt: salt })
    expect(composed.ok && decomposed.ok && composed.value).toEqual(
      decomposed.ok ? decomposed.value : null,
    )
  }, 30000)
})
