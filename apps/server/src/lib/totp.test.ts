import { describe, expect, it } from 'vitest'
import { retryAfterSeconds } from '../auth/limiter'
import {
  decryptTotpSecret,
  encryptTotpSecret,
  matchTotpStep,
  newRecoveryCodes,
  normalizeRecoveryCode,
  otpauthUri,
  secretFromOtpauthUri,
  totpCode,
  totpStep,
} from './totp'

const rfcSecret = new TextEncoder().encode('12345678901234567890')

describe('TOTP (RFC 6238, SHA-1)', () => {
  // RFC 6238 appendix B lists 8 digit codes; these are their last 6 digits.
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
    [20000000000, '353130'],
  ])('matches the RFC vector at time %i', async (time, expected) => {
    expect(await totpCode(rfcSecret, totpStep(time))).toBe(expected)
  })

  it('accepts the previous, current, and next step, and nothing further away', async () => {
    const now = 1_700_000_015
    const step = totpStep(now)
    for (const offset of [-1, 0, 1]) {
      const code = await totpCode(rfcSecret, step + offset)
      expect(await matchTotpStep(rfcSecret, code, now, null)).toBe(step + offset)
    }
    expect(
      await matchTotpStep(rfcSecret, await totpCode(rfcSecret, step + 2), now, null),
    ).toBeNull()
    expect(
      await matchTotpStep(rfcSecret, await totpCode(rfcSecret, step - 2), now, null),
    ).toBeNull()
  })

  it('refuses a code at or below the last accepted step', async () => {
    const now = 1_700_000_015
    const step = totpStep(now)
    const code = await totpCode(rfcSecret, step)
    expect(await matchTotpStep(rfcSecret, code, now, step)).toBeNull()
    expect(await matchTotpStep(rfcSecret, code, now, step + 1)).toBeNull()
    expect(await matchTotpStep(rfcSecret, code, now, step - 1)).toBe(step)
  })

  it('round trips the secret through the otpauth link and through encryption at rest', async () => {
    const uri = otpauthUri(rfcSecret, 'me@example.com')
    expect(secretFromOtpauthUri(uri)).toEqual(rfcSecret)
    const key = new Uint8Array(32).fill(4)
    const stored = await encryptTotpSecret(key, rfcSecret)
    expect(await decryptTotpSecret(key, stored)).toEqual(rfcSecret)
    stored[stored.length - 1] = (stored[stored.length - 1] ?? 0) ^ 1
    expect(await decryptTotpSecret(key, stored)).toBeNull()
    expect(
      await decryptTotpSecret(new Uint8Array(32).fill(5), await encryptTotpSecret(key, rfcSecret)),
    ).toBeNull()
  })

  it('makes 10 distinct recovery codes of 16 Base32 characters', () => {
    const codes = newRecoveryCodes()
    expect(new Set(codes).size).toBe(10)
    expect(codes.every((code) => /^[A-Z2-7]{16}$/.test(code))).toBe(true)
    expect(normalizeRecoveryCode(' abcd-efgh ijkl-mnop ')).toBe('ABCDEFGHIJKLMNOP')
  })
})

describe('limiter wait', () => {
  it('is zero below 5 failures, then doubles from 60 seconds up to one hour', () => {
    expect([0, 4, 5, 6, 7, 8, 10, 11, 50].map(retryAfterSeconds)).toEqual([
      0, 0, 60, 120, 240, 480, 1920, 3600, 3600,
    ])
  })
})
