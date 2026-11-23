import { describe, expect, it } from 'vitest'
import { loginItem } from '../test-items'
import { checkPage, matchItem, matchLogins, toSuggestion } from './rules'

const page = (senderOrigin: string | undefined, topUrl?: string, frameUrl?: string) =>
  checkPage({
    senderOrigin,
    topUrl: topUrl ?? (senderOrigin ? `${senderOrigin}/login` : undefined),
    frameUrl: frameUrl ?? (senderOrigin ? `${senderOrigin}/login` : undefined),
  })

describe('checkPage (fill rules 4 and 5)', () => {
  it('accepts an https frame that is the top page', () => {
    expect(page('https://shop.example.com')).toEqual({
      ok: true,
      value: 'https://shop.example.com',
    })
  })

  it('accepts a same origin child frame', () => {
    expect(
      page('https://shop.example.com', 'https://shop.example.com/', 'https://shop.example.com/f'),
    ).toEqual({ ok: true, value: 'https://shop.example.com' })
  })

  it('refuses http', () => {
    expect(page('http://shop.example.com')).toEqual({ ok: false, error: 'insecure' })
  })

  it('refuses a frame whose origin differs from the top page', () => {
    expect(page('https://shop.example.com', 'https://evil.example.net/')).toEqual({
      ok: false,
      error: 'cross_origin',
    })
  })

  it('refuses when the browser reports another URL for the frame', () => {
    expect(
      page('https://shop.example.com', 'https://shop.example.com/', 'https://evil.example.net/'),
    ).toEqual({ ok: false, error: 'cross_origin' })
  })

  it('refuses a different port or scheme as a different origin', () => {
    expect(page('https://shop.example.com', 'https://shop.example.com:8443/').ok).toBe(false)
  })

  it('refuses a sandboxed frame, a missing origin, and a missing frame or top URL', () => {
    expect(page('null', 'https://a.example/', 'https://a.example/')).toEqual({
      ok: false,
      error: 'unknown_page',
    })
    expect(page(undefined).ok).toBe(false)
    expect(
      checkPage({ senderOrigin: 'https://a.example', topUrl: undefined, frameUrl: undefined }),
    ).toEqual({ ok: false, error: 'unknown_page' })
  })

  it('refuses a sender origin that is not a bare origin', () => {
    expect(page('https://shop.example.com/path').ok).toBe(false)
  })
})

describe('matchItem (fill rule 6)', () => {
  const shop = loginItem('1', 'Shop', 'ada', 'pw', ['https://shop.example.com/login'])

  it('matches by registrable domain', () => {
    expect(matchItem(shop, 'https://shop.example.com')).toBe('host')
    expect(matchItem(shop, 'https://pay.example.com')).toBe('domain')
  })

  it('does not match a lookalike or another domain', () => {
    expect(matchItem(shop, 'https://examp1e.com')).toBeNull()
    expect(matchItem(shop, 'https://example.com.evil.net')).toBeNull()
  })

  it('treats hosts under a public suffix as different sites', () => {
    const pages = loginItem('2', 'Pages', 'alice', 'pw', ['https://alice.github.io'])
    expect(matchItem(pages, 'https://alice.github.io')).toBe('host')
    expect(matchItem(pages, 'https://bob.github.io')).toBeNull()
  })

  it('honors exact host mode', () => {
    const exact = loginItem('3', 'Exact', 'a', 'pw', [
      { url: 'https://login.example.com', match: 'host' },
    ])
    expect(matchItem(exact, 'https://login.example.com')).toBe('host')
    expect(matchItem(exact, 'https://other.example.com')).toBeNull()
  })

  it('matches a saved explicit port only on that port', () => {
    const ported = loginItem('4', 'Port', 'a', 'pw', ['https://app.example.com:8443'])
    expect(matchItem(ported, 'https://app.example.com:8443')).toBe('host')
    expect(matchItem(ported, 'https://app.example.com')).toBeNull()
  })

  it('never matches a trashed item', () => {
    const trashed = loginItem('5', 'Old', 'a', 'pw', ['https://shop.example.com'], {
      trashed: true,
    })
    expect(matchItem(trashed, 'https://shop.example.com')).toBeNull()
  })
})

describe('matchLogins', () => {
  const items = [
    loginItem('d1', 'Zeta', 'z', 'pw', ['https://example.com']),
    loginItem('h1', 'Beta', 'b', 'pw', ['https://shop.example.com']),
    loginItem('h2', 'Alpha', 'a', 'pw', ['https://shop.example.com']),
    loginItem('d2', 'Gamma', 'g', 'pw', ['https://pay.example.com']),
    loginItem('x', 'Other', 'o', 'pw', ['https://other.org']),
  ]

  it('orders exact host first, then most recently used, then name', () => {
    const ids = (lastUsed: Record<string, number>) =>
      matchLogins(items, 'https://shop.example.com', lastUsed).map((match) => match.item.id)
    expect(ids({})).toEqual(['h2', 'h1', 'd2', 'd1'])
    expect(ids({ h1: 50, d1: 99 })).toEqual(['h1', 'h2', 'd1', 'd2'])
  })

  it('leaves out items for other sites', () => {
    expect(matchLogins(items, 'https://other.org', {}).map((match) => match.item.id)).toEqual(['x'])
  })
})

describe('toSuggestion', () => {
  it('carries the name and username but never the password', () => {
    const suggestion = toSuggestion(
      loginItem('1', 'Shop', 'ada', 'secret-pw', ['https://a.example']),
    )
    expect(suggestion).toEqual({ item_id: '1', name: 'Shop', username: 'ada' })
    expect(JSON.stringify(suggestion)).not.toContain('secret-pw')
  })
})
