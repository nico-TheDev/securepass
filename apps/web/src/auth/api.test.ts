import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { postLogin, postPrelogin, postSetup } from './api'

const fetchMock = vi.fn<typeof fetch>()

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

beforeEach(() => vi.stubGlobal('fetch', fetchMock))
afterEach(() => {
  fetchMock.mockReset()
  vi.unstubAllGlobals()
})

const kdf = { alg: 'argon2id', m: 65536, t: 3, p: 1 }

describe('postPrelogin', () => {
  it('posts the email as JSON and returns the parsed KDF settings', async () => {
    fetchMock.mockResolvedValue(json({ kdf, kdf_salt: 'c2FsdA' }))

    const result = await postPrelogin('me@example.com')

    expect(result).toEqual({ ok: true, value: { kdf, kdf_salt: 'c2FsdA' } })
    const [url, init] = fetchMock.mock.calls[0] ?? []
    expect(url).toBe('/api/auth/prelogin')
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({ email: 'me@example.com' })
  })

  it('returns a network error when fetch rejects', async () => {
    fetchMock.mockRejectedValue(new TypeError('offline'))
    expect(await postPrelogin('me@example.com')).toEqual({ ok: false, error: { kind: 'network' } })
  })

  it('returns the status and code from a failed reply', async () => {
    fetchMock.mockResolvedValue(json({ code: 'revoked' }, 401))
    expect(await postPrelogin('me@example.com')).toEqual({
      ok: false,
      error: { kind: 'status', status: 401, code: 'revoked' },
    })
  })

  it('falls back to the error field when there is no code', async () => {
    fetchMock.mockResolvedValue(json({ error: 'nope' }, 409))
    expect(await postPrelogin('me@example.com')).toEqual({
      ok: false,
      error: { kind: 'status', status: 409, code: 'nope' },
    })
  })

  it('returns only the status when the failed reply is not JSON', async () => {
    fetchMock.mockResolvedValue(new Response('<html>bad gateway</html>', { status: 502 }))
    expect(await postPrelogin('me@example.com')).toEqual({
      ok: false,
      error: { kind: 'status', status: 502 },
    })
  })

  it('treats a successful reply with the wrong shape as a 502', async () => {
    fetchMock.mockResolvedValue(json({ unexpected: true }))
    expect(await postPrelogin('me@example.com')).toEqual({
      ok: false,
      error: { kind: 'status', status: 502 },
    })
  })
})

describe('postSetup', () => {
  it('sends the setup token in the X-Setup-Token header, not the body', async () => {
    fetchMock.mockResolvedValue(json({}, 401))

    await postSetup('tok-123', { email: 'me@example.com' } as never)

    const [, init] = fetchMock.mock.calls[0] ?? []
    expect(new Headers(init?.headers).get('X-Setup-Token')).toBe('tok-123')
    expect(String(init?.body)).not.toContain('tok-123')
  })
})

describe('postLogin', () => {
  it('posts to the login route and surfaces a 401 as a status error', async () => {
    fetchMock.mockResolvedValue(json({ error: 'bad credentials' }, 401))

    const result = await postLogin({ email: 'a@b.c', auth_key: 'x', device_name: 'Web vault' })

    expect(fetchMock.mock.calls[0]?.[0]).toBe('/api/auth/login')
    expect(result).toMatchObject({ ok: false, error: { kind: 'status', status: 401 } })
  })
})
