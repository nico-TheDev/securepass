import { describe, expect, it } from 'vitest'
import { parseServerUrl } from '../server-url'
import { LOCK_AFTER_MS, MAX_PIN_FAILURES, pinFailureOutcome, shouldLock } from './rules'

describe('shouldLock', () => {
  const now = 10_000_000

  it('stays unlocked while the last activity is under 15 minutes old', () => {
    expect(shouldLock(now, now)).toBe(false)
    expect(shouldLock(now - LOCK_AFTER_MS + 1, now)).toBe(false)
  })

  it('locks at 15 minutes and when no activity was ever recorded', () => {
    expect(shouldLock(now - LOCK_AFTER_MS, now)).toBe(true)
    expect(shouldLock(undefined, now)).toBe(true)
  })
})

describe('pinFailureOutcome', () => {
  it('counts down the tries and removes the PIN at the fifth failure', () => {
    expect(pinFailureOutcome(1)).toEqual({ remove: false, left: 4 })
    expect(pinFailureOutcome(MAX_PIN_FAILURES - 1)).toEqual({ remove: false, left: 1 })
    expect(pinFailureOutcome(MAX_PIN_FAILURES)).toEqual({ remove: true, left: 0 })
    expect(pinFailureOutcome(9)).toEqual({ remove: true, left: 0 })
  })
})

describe('parseServerUrl', () => {
  it('returns the origin of an https URL', () => {
    expect(parseServerUrl('https://vault.example.com/some/path/', true)).toEqual({
      ok: true,
      value: 'https://vault.example.com',
    })
  })

  it('allows http only for a local server', () => {
    expect(parseServerUrl('http://localhost:8787', true).ok).toBe(true)
    expect(parseServerUrl('http://127.0.0.1:8799', true).ok).toBe(true)
    expect(parseServerUrl('http://vault.example.com', true).ok).toBe(false)
  })

  it('requires the setting in a production build and defaults it in development', () => {
    expect(parseServerUrl(undefined, true).ok).toBe(false)
    expect(parseServerUrl('  ', false)).toEqual({ ok: true, value: 'http://localhost:8787' })
  })

  it('refuses text that is not a URL', () => {
    expect(parseServerUrl('not a url', false).ok).toBe(false)
  })
})
