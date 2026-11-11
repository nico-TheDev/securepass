import { randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  account,
  call,
  currentCode,
  FLOOR,
  freshCode,
  login,
  newIp,
  putItem,
  randomKey,
  rememberTotp,
  SETUP_TOKEN,
  setupBody,
  sql,
  sync,
} from './helpers'

type Item = { id: string; revision: number; ciphertext: string | null; purged: boolean }
const itemsOf = (json: Record<string, unknown>): Item[] => json.items as Item[]

let first = ''

describe('setup (AC-1)', () => {
  it('refuses a missing or wrong setup token', async () => {
    expect((await call('/api/setup', { body: setupBody() })).status).toBe(401)
    const wrong = await call('/api/setup', {
      body: setupBody(),
      headers: { 'X-Setup-Token': 'not-the-token-000000' },
    })
    expect(wrong.status).toBe(401)
  })

  it('refuses KDF settings below the floor with 422', async () => {
    const weak = await call('/api/setup', {
      body: { ...setupBody(), kdf: { ...FLOOR, m: 19456 } },
      headers: { 'X-Setup-Token': SETUP_TOKEN },
    })
    expect(weak.status).toBe(422)
  })

  it('creates the account once, then answers 409', async () => {
    const created = await call('/api/setup', {
      body: setupBody(),
      headers: { 'X-Setup-Token': SETUP_TOKEN },
    })
    expect(created.status).toBe(201)
    first = created.json.token as string
    const again = await call('/api/setup', {
      body: { ...setupBody(), account_id: randomUUID(), email: 'other@example.com' },
      headers: { 'X-Setup-Token': SETUP_TOKEN },
    })
    expect(again.status).toBe(409)
  })
})

describe('prelogin', () => {
  it('returns the real settings for the account and a stable fake for an unknown email', async () => {
    const real = await call('/api/auth/prelogin', { body: { email: ' Owner@Example.com ' } })
    expect(real.json).toEqual({ kdf: FLOOR, kdf_salt: account.kdfSalt })
    const ip = newIp()
    const fakeA = await call('/api/auth/prelogin', { body: { email: 'nobody@example.com' }, ip })
    const fakeB = await call('/api/auth/prelogin', { body: { email: 'nobody@example.com' }, ip })
    expect(fakeA.status).toBe(200)
    expect(fakeA.json).toEqual(fakeB.json)
    expect(fakeA.json.kdf).toEqual(FLOOR)
    expect(fakeA.json.kdf_salt).not.toBe(account.kdfSalt)
  })
})

describe('TOTP enrollment and login (AC-4)', () => {
  it('lets login through without a code only until TOTP is enabled', async () => {
    const reply = await call('/api/auth/login', {
      body: { email: account.email, auth_key: account.authKey, device_name: 'Early device' },
    })
    expect(reply.status).toBe(200)
    expect(reply.json.account_id).toBe(account.id)
    expect(reply.json.wrapped_vault_key).toBe(account.wrappedVaultKey)
  })

  it('enrolls, refuses a wrong code with 422, then confirms', async () => {
    const enroll = await call('/api/account/totp', { token: first })
    expect(enroll.status).toBe(200)
    expect(enroll.json.otpauth_uri).toMatch(
      /^otpauth:\/\/totp\/securepass%3Aowner%40example\.com\?secret=[A-Z2-7]{32}&/,
    )
    const codes = enroll.json.recovery_codes as string[]
    expect(codes).toHaveLength(10)
    expect(codes.every((code) => /^[A-Z2-7]{16}$/.test(code))).toBe(true)
    rememberTotp(enroll.json.otpauth_uri as string, codes)

    const wrong = await call('/api/account/totp/confirm', {
      token: first,
      body: { totp_code: '000000' === (await currentCode()) ? '111111' : '000000' },
    })
    expect(wrong.status).toBe(422)
    const confirmed = await call('/api/account/totp/confirm', {
      token: first,
      body: { totp_code: await currentCode() },
    })
    expect(confirmed.status).toBe(204)
    expect((await call('/api/account/totp', { token: first })).status).toBe(409)
  })

  it('now needs the auth key and a code together, with one answer for any mistake', async () => {
    const ip = newIp()
    const base = { email: account.email, device_name: 'Laptop' }
    const noCode = await call('/api/auth/login', {
      body: { ...base, auth_key: account.authKey },
      ip,
    })
    expect(noCode.status).toBe(401)
    expect(noCode.json.code).toBe('invalid')
    const wrongKey = await call('/api/auth/login', {
      body: { ...base, auth_key: randomKey(), totp_code: await freshCode() },
      ip,
    })
    expect(wrongKey.json).toEqual(noCode.json)
    // The wrong key did not burn the good code.
    const good = await call('/api/auth/login', {
      body: { ...base, auth_key: account.authKey, totp_code: await currentCode() },
      ip,
    })
    expect(good.status).toBe(200)
  })

  it('refuses a TOTP code that was already used', async () => {
    const body = {
      email: account.email,
      auth_key: account.authKey,
      device_name: 'Laptop',
      totp_code: await freshCode(),
    }
    const ip = newIp()
    expect((await call('/api/auth/login', { body, ip })).status).toBe(200)
    expect((await call('/api/auth/login', { body, ip })).status).toBe(401)
  })

  it('accepts a recovery code once', async () => {
    const body = {
      email: account.email,
      auth_key: account.authKey,
      device_name: 'Laptop',
      recovery_code: account.recoveryCodes[0]?.toLowerCase(),
    }
    const ip = newIp()
    expect((await call('/api/auth/login', { body, ip })).status).toBe(200)
    expect((await call('/api/auth/login', { body, ip })).status).toBe(401)
  })
})

describe('login limiter (AC-4)', () => {
  it('answers 401 five times, then 429 with Retry-After 60 even for correct credentials', async () => {
    const ip = newIp()
    const wrong = { email: account.email, auth_key: randomKey(), device_name: 'Guess' }
    for (let attempt = 0; attempt < 5; attempt++) {
      expect((await call('/api/auth/login', { body: wrong, ip })).status).toBe(401)
    }
    const blocked = await call('/api/auth/login', {
      body: { ...wrong, auth_key: account.authKey, totp_code: await freshCode() },
      ip,
    })
    expect(blocked.status).toBe(429)
    expect(blocked.headers.get('Retry-After')).toBe('60')
    // Prelogin from the blocked IP is refused too.
    expect((await call('/api/auth/prelogin', { body: { email: account.email }, ip })).status).toBe(
      429,
    )

    // Once the wait has passed the IP is checked again; one more failure doubles the wait.
    sql('UPDATE login_attempt SET at = at - 61')
    expect((await call('/api/auth/login', { body: wrong, ip })).status).toBe(401)
    const doubled = await call('/api/auth/login', { body: wrong, ip })
    expect(doubled.status).toBe(429)
    expect(doubled.headers.get('Retry-After')).toBe('120')
  })

  it('only slows the account when failures come from many IPs, and never locks the owner out', async () => {
    sql('DELETE FROM login_attempt')
    const wrong = { email: account.email, auth_key: randomKey(), device_name: 'Guess' }
    for (let attempt = 0; attempt < 25; attempt++) {
      expect((await call('/api/auth/login', { body: wrong, ip: newIp() })).status).toBe(401)
    }
    const started = Date.now()
    const owner = await call('/api/auth/login', {
      body: {
        email: account.email,
        auth_key: account.authKey,
        device_name: 'Owner',
        totp_code: await freshCode(),
      },
      ip: newIp(),
    })
    expect(owner.status).toBe(200)
    expect(Date.now() - started).toBeGreaterThanOrEqual(1900)
    // The success cleared the account counter, so the next attempt is not slowed.
    const again = Date.now()
    expect((await call('/api/auth/login', { body: wrong, ip: newIp() })).status).toBe(401)
    expect(Date.now() - again).toBeLessThan(1500)
  })
})

describe('item sync (AC-8, AC-9, AC-23)', () => {
  const id = randomUUID()
  it('stores an item and a second device reads it back through sync', async () => {
    const written = await putItem(first, id, 0, false, 'Y2lwaGVydGV4dA')
    expect(written.status).toBe(200)
    const second = await login()
    const pulled = await sync(second)
    expect(pulled.status).toBe(200)
    const row = itemsOf(pulled.json).find((item) => item.id === id)
    expect(row).toMatchObject({ ciphertext: 'Y2lwaGVydGV4dA', purged: false })
    expect(pulled.json.revision).toBe(written.json.revision)
    expect(pulled.json.full_resync).toBe(false)
  })

  it('answers 409 with the current row when two writes share a base revision', async () => {
    const current = itemsOf((await sync(first)).json).find((item) => item.id === id)
    const base = current?.revision ?? -1
    expect((await putItem(first, id, base)).status).toBe(200)
    const stale = await putItem(first, id, base)
    expect(stale.status).toBe(409)
    expect((stale.json.current as Item).id).toBe(id)
    expect((stale.json.current as Item).revision).toBeGreaterThan(base)
  })

  it('refuses a ciphertext over 64 KiB with 413 and a missing If-Match with 400', async () => {
    expect((await putItem(first, randomUUID(), 0, false, randomKey(65537))).status).toBe(413)
    const noMatch = await call(`/api/items/${randomUUID()}`, {
      method: 'PUT',
      token: first,
      body: { ciphertext: 'YQ', trashed: false },
    })
    expect(noMatch.status).toBe(400)
  })

  it('stores per item only id, revision, times, size, and trash or purge state', () => {
    const columns = sql("SELECT name FROM pragma_table_info('item')").map((row) => row.name)
    expect(columns.sort()).toEqual([
      'account_id',
      'ciphertext',
      'created_at',
      'deleted_at',
      'id',
      'purge_after',
      'purged_at',
      'revision',
      'size',
      'updated_at',
    ])
  })
})

describe('trash, delete, and purge (AC-11)', () => {
  it('trash sets a 30 day purge time and restore clears it', async () => {
    const id = randomUUID()
    const created = await putItem(first, id, 0)
    const trashed = await putItem(first, id, created.json.revision as number, true)
    const thirtyDays = 30 * 24 * 60 * 60
    expect((trashed.json.purge_after as number) - (trashed.json.updated_at as number)).toBe(
      thirtyDays,
    )
    const restored = await putItem(first, id, trashed.json.revision as number, false)
    expect(restored.json.purge_after).toBeNull()
  })

  it('permanent delete needs a fresh TOTP code and leaves a tombstone', async () => {
    const id = randomUUID()
    const created = await putItem(first, id, 0)
    const revision = created.json.revision as number
    const headers = { 'If-Match': String(revision) }
    const noCode = await call(`/api/items/${id}`, {
      method: 'DELETE',
      token: first,
      headers,
      body: {},
    })
    expect(noCode.status).toBe(401)
    const stale = await call(`/api/items/${id}`, {
      method: 'DELETE',
      token: first,
      headers: { 'If-Match': '1' },
      body: { totp_code: await freshCode() },
    })
    expect(stale.status).toBe(409)
    const deleted = await call(`/api/items/${id}`, {
      method: 'DELETE',
      token: first,
      headers,
      body: { totp_code: await freshCode() },
    })
    expect(deleted.status).toBe(204)
    const row = itemsOf((await sync(first, revision)).json).find((item) => item.id === id)
    expect(row).toMatchObject({ ciphertext: null, purged: true })
    expect((await putItem(first, id, row?.revision ?? 0)).status).toBe(410)
    const missing = await call(`/api/items/${randomUUID()}`, {
      method: 'DELETE',
      token: first,
      headers,
      body: { totp_code: await freshCode() },
    })
    expect(missing.status).toBe(404)
  })

  it('empty trash turns every trashed item into a tombstone and leaves the rest', async () => {
    const kept = randomUUID()
    const gone = randomUUID()
    await putItem(first, kept, 0)
    const created = await putItem(first, gone, 0)
    await putItem(first, gone, created.json.revision as number, true)
    const emptied = await call('/api/trash', {
      method: 'DELETE',
      token: first,
      body: { totp_code: await freshCode() },
    })
    expect(emptied.status).toBe(204)
    const items = itemsOf((await sync(first)).json)
    expect(items.find((item) => item.id === gone)).toMatchObject({ purged: true })
    expect(items.find((item) => item.id === kept)).toMatchObject({ purged: false })
  })

  it('the daily job purges items past 30 days, and restore past that time is 410', async () => {
    const id = randomUUID()
    const created = await putItem(first, id, 0)
    const trashed = await putItem(first, id, created.json.revision as number, true)
    sql(`UPDATE item SET purge_after = ${Math.floor(Date.now() / 1000) - 5} WHERE id = '${id}'`)
    // Even before the job runs, a restore past the purge time is refused.
    expect((await putItem(first, id, trashed.json.revision as number, false)).status).toBe(410)
    const before = (await sync(first)).json.revision as number
    expect((await call('/__scheduled', { method: 'GET' })).status).toBe(200)
    const after = await sync(first, before)
    expect(itemsOf(after.json)).toEqual([
      expect.objectContaining({ id, purged: true, ciphertext: null }),
    ])
    expect(after.json.revision).toBe(before + 1)
  })

  it('asks for a full resync when the device last synced before a deleted tombstone', async () => {
    const old = Math.floor(Date.now() / 1000) - 91 * 24 * 60 * 60
    const tombstones = sql(
      'SELECT id, revision FROM item WHERE purged_at IS NOT NULL ORDER BY revision',
    )
    expect(tombstones.length).toBeGreaterThanOrEqual(2)
    sql(`UPDATE item SET purged_at = ${old} WHERE purged_at IS NOT NULL`)
    await call('/__scheduled', { method: 'GET' })
    // Only the newest expired tombstone is kept, as the marker.
    const left = sql('SELECT id, revision FROM item WHERE purged_at IS NOT NULL')
    expect(left).toHaveLength(1)
    const marker = left[0]?.revision as number
    const behind = await sync(first, marker - 1)
    expect(behind.json.full_resync).toBe(true)
    const everything = await sync(first, 0)
    expect(everything.json.full_resync).toBe(false)
    expect(itemsOf(behind.json)).toHaveLength(itemsOf(everything.json).length)
    expect((await sync(first, marker)).json.full_resync).toBe(false)
  })
})

describe('devices (AC-22)', () => {
  it('lists devices, revokes one with a fresh code, and the revoked token gets 401 revoked', async () => {
    const other = await login('Phone')
    const list = await call('/api/devices', { method: 'GET', token: first })
    const devices = list.json.devices as { id: string; name: string; current: boolean }[]
    expect(devices.filter((device) => device.current)).toHaveLength(1)
    const phone = devices.findLast((device) => device.name === 'Phone')
    expect(phone).toBeDefined()

    const noCode = await call(`/api/devices/${phone?.id}`, {
      method: 'DELETE',
      token: first,
      body: {},
    })
    expect(noCode.status).toBe(401)
    expect((await sync(other)).status).toBe(200)
    const revoked = await call(`/api/devices/${phone?.id}`, {
      method: 'DELETE',
      token: first,
      body: { totp_code: await freshCode() },
    })
    expect(revoked.status).toBe(204)
    const refused = await sync(other)
    expect(refused.status).toBe(401)
    expect(refused.json.code).toBe('revoked')
    const unknown = await call(`/api/devices/${randomUUID()}`, {
      method: 'DELETE',
      token: first,
      body: { totp_code: await freshCode() },
    })
    expect(unknown.status).toBe(404)
  })

  it('an expired session gets 401 expired, and logout revokes the session', async () => {
    const token = await login('Tablet')
    sql("UPDATE device_session SET expires_at = 1 WHERE device_name = 'Tablet'")
    const expired = await sync(token)
    expect(expired.status).toBe(401)
    expect(expired.json.code).toBe('expired')

    const leaving = await login('Kiosk')
    expect((await call('/api/auth/logout', { token: leaving })).status).toBe(204)
    expect((await sync(leaving)).json.code).toBe('revoked')
    expect((await sync('not-a-token')).json.code).toBe('invalid')
  })
})

describe('password change (AC-21)', () => {
  it('rotates the auth key, revokes every other session, and leaves items alone', async () => {
    const other = await login('Other')
    const itemsBefore = itemsOf((await sync(first)).json)
    const next = { authKey: randomKey(), kdfSalt: randomKey(16), wrappedVaultKey: randomKey(73) }
    const body = {
      kdf: { ...FLOOR, t: 4 },
      kdf_salt: next.kdfSalt,
      auth_key: next.authKey,
      wrapped_vault_key: next.wrappedVaultKey,
    }

    const weak = await call('/api/account/password', {
      token: first,
      body: {
        ...body,
        kdf: { ...FLOOR, m: 1024 },
        current_auth_key: account.authKey,
        totp_code: await freshCode(),
      },
    })
    expect(weak.status).toBe(422)
    const wrongCurrent = await call('/api/account/password', {
      token: first,
      body: { ...body, current_auth_key: randomKey(), totp_code: await freshCode() },
    })
    expect(wrongCurrent.status).toBe(401)
    const noCode = await call('/api/account/password', {
      token: first,
      body: { ...body, current_auth_key: account.authKey },
    })
    expect(noCode.status).toBe(401)

    const changed = await call('/api/account/password', {
      token: first,
      body: { ...body, current_auth_key: account.authKey, totp_code: await freshCode() },
    })
    expect(changed.status).toBe(200)
    const oldAuthKey = account.authKey
    Object.assign(account, next)

    expect((await sync(other)).json.code).toBe('revoked')
    expect((await sync(first)).json.code).toBe('revoked')
    first = changed.json.token as string
    expect(itemsOf((await sync(first)).json)).toEqual(itemsBefore)

    const prelogin = await call('/api/auth/prelogin', { body: { email: account.email } })
    expect(prelogin.json).toEqual({ kdf: { ...FLOOR, t: 4 }, kdf_salt: next.kdfSalt })
    const oldKey = await call('/api/auth/login', {
      body: {
        email: account.email,
        auth_key: oldAuthKey,
        device_name: 'Old',
        totp_code: await freshCode(),
      },
      ip: newIp(),
    })
    expect(oldKey.status).toBe(401)
    expect((await call('/api/devices', { method: 'GET', token: await login('New') })).status).toBe(
      200,
    )
  })
})

describe('recovery (AC-20)', () => {
  const newKit = () => ({
    kdf: FLOOR,
    kdf_salt: randomKey(16),
    auth_key: randomKey(),
    wrapped_vault_key: randomKey(73),
    recovery_auth_key: randomKey(),
    wrapped_vault_key_recovery: randomKey(73),
    device_name: 'Recovered',
  })
  const recover = async (recoveryAuthKey: string, ip = newIp()) =>
    call('/api/auth/recover', {
      body: {
        email: account.email,
        recovery_auth_key: recoveryAuthKey,
        totp_code: await freshCode(),
      },
      ip,
    })

  it('refuses a wrong recovery key or a missing second proof', async () => {
    expect((await recover(randomKey())).status).toBe(401)
    const noCode = await call('/api/auth/recover', {
      body: { email: account.email, recovery_auth_key: account.recoveryAuthKey },
      ip: newIp(),
    })
    expect(noCode.status).toBe(401)
  })

  it('a recovery token expires after 10 minutes and cannot be used as a session', async () => {
    const granted = await recover(account.recoveryAuthKey)
    expect(granted.status).toBe(200)
    expect(granted.json.wrapped_vault_key_recovery).toBe(account.wrappedVaultKeyRecovery)
    expect(granted.json.account_id).toBe(account.id)
    const token = granted.json.recovery_token as string
    expect((await sync(token)).status).toBe(401)
    sql('UPDATE account SET recovery_token_expires_at = 1')
    const late = await call('/api/account/password', {
      body: { ...newKit(), recovery_token: token },
    })
    expect(late.status).toBe(401)
  })

  it('sets a new password and kit once; the old kit, old codes, and old sessions stop working', async () => {
    const session = await login('Before recovery')
    const granted = await recover(account.recoveryAuthKey)
    const token = granted.json.recovery_token as string
    const kit = newKit()
    const done = await call('/api/account/password', { body: { ...kit, recovery_token: token } })
    expect(done.status).toBe(200)
    const newCodes = done.json.recovery_codes as string[]
    expect(newCodes).toHaveLength(10)
    const oldRecoveryAuthKey = account.recoveryAuthKey
    const oldCode = account.recoveryCodes[1] as string
    Object.assign(account, {
      authKey: kit.auth_key,
      kdfSalt: kit.kdf_salt,
      wrappedVaultKey: kit.wrapped_vault_key,
      recoveryAuthKey: kit.recovery_auth_key,
      wrappedVaultKeyRecovery: kit.wrapped_vault_key_recovery,
      recoveryCodes: newCodes,
    })

    // Single use.
    const again = await call('/api/account/password', {
      body: { ...newKit(), recovery_token: token },
    })
    expect(again.status).toBe(401)
    expect((await sync(session)).json.code).toBe('revoked')
    expect((await sync(done.json.token as string)).status).toBe(200)
    expect((await recover(oldRecoveryAuthKey)).status).toBe(401)
    const oldCodeLogin = await call('/api/auth/login', {
      body: {
        email: account.email,
        auth_key: account.authKey,
        device_name: 'x',
        recovery_code: oldCode,
      },
      ip: newIp(),
    })
    expect(oldCodeLogin.status).toBe(401)
    const newCodeRecover = await call('/api/auth/recover', {
      body: {
        email: account.email,
        recovery_auth_key: account.recoveryAuthKey,
        recovery_code: newCodes[0],
      },
      ip: newIp(),
    })
    expect(newCodeRecover.status).toBe(200)
  })
})

describe('security headers and CORS', () => {
  it('sends the CSP and friends on API replies and on the web vault page', async () => {
    for (const path of ['/api/health', '/']) {
      const reply = await call(path, { method: 'GET' })
      expect(reply.status).toBe(200)
      expect(reply.headers.get('Content-Security-Policy')).toContain(
        "script-src 'self' 'wasm-unsafe-eval'",
      )
      expect(reply.headers.get('X-Content-Type-Options')).toBe('nosniff')
      expect(reply.headers.get('Referrer-Policy')).toBe('no-referrer')
      expect(reply.headers.get('Strict-Transport-Security')).toContain('max-age=')
    }
  })

  it('allows only the listed extension origins', async () => {
    const allowed = await call('/api/health', {
      method: 'GET',
      headers: { Origin: 'chrome-extension://testextensionid' },
    })
    expect(allowed.status).toBe(200)
    const listed = await call('/api/sync', {
      method: 'OPTIONS',
      headers: {
        Origin: 'chrome-extension://testextensionid',
        'Access-Control-Request-Method': 'GET',
      },
    })
    expect(listed.headers.get('Access-Control-Allow-Origin')).toBe(
      'chrome-extension://testextensionid',
    )
    const other = await call('/api/sync', {
      method: 'OPTIONS',
      headers: { Origin: 'https://evil.example', 'Access-Control-Request-Method': 'GET' },
    })
    expect(other.headers.get('Access-Control-Allow-Origin')).toBeNull()
  })

  it('answers unknown API paths with JSON, never the web page', async () => {
    const reply = await call('/api/nope', { method: 'GET' })
    expect(reply.status).toBe(401)
    expect(reply.json.error).toBe('unauthorized')
  })
})
