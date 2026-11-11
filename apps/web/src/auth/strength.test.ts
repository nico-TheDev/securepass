import { describe, expect, it } from 'vitest'
import { measureStrength } from './strength'

describe('measureStrength', () => {
  it('scores an empty password 0 with no warning', () => {
    expect(measureStrength('', 'me@example.com')).toEqual({ score: 0, warning: '' })
  })

  it('scores a very common password at the bottom of the scale', () => {
    expect(measureStrength('password', 'me@example.com').score).toBeLessThanOrEqual(1)
  })

  it('scores a long random passphrase as strong', () => {
    expect(measureStrength('correct-horse-battery-staple-7Q!vz', 'me@example.com').score).toBe(4)
  })

  it('treats the email as a known word so it cannot carry the score', () => {
    const email = 'zqxjkvbw.mnrtplh@example.com'
    const withoutEmail = measureStrength(email, '')
    const withEmail = measureStrength(email, email)
    expect(withEmail.score).toBeLessThan(withoutEmail.score)
  })

  it('does not throw when the email is empty', () => {
    expect(() => measureStrength('some password', '')).not.toThrow()
  })
})
