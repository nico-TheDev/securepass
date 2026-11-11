import { execFileSync } from 'node:child_process'
import { randomBytes, randomUUID } from 'node:crypto'
import { inject } from 'vitest'
import { secretFromOtpauthUri, totpCode, totpStep } from '../src/lib/totp'
import { TEST_VARS } from './global-setup'

export const b64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64url')
export const randomKey = (length = 32): string => b64(randomBytes(length))
export const FLOOR = { alg: 'argon2id', m: 65536, t: 3, p: 1 } as const

let ipCounter = 0
/** A fresh fake client IP, so one test's failures never trip the limiter for another. */
export const newIp = (): string => `10.${Math.floor(ipCounter / 250)}.${ipCounter++ % 250}.7`

type CallOptions = {
  readonly method?: string
  readonly body?: unknown
  readonly token?: string
  readonly ip?: string
  readonly headers?: Record<string, string>
}

/** Calls the local Worker and returns the status, headers, and parsed JSON body. */
export const call = async (
  path: string,
  { method = 'POST', body, token, ip = '10.250.0.1', headers = {} }: CallOptions = {},
): Promise<{ status: number; headers: Headers; json: Record<string, unknown> }> => {
  const response = await fetch(`${inject('baseUrl')}${path}`, {
    method,
    headers: {
      'CF-Connecting-IP': ip,
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  })
  const json = (await response.json().catch(() => ({}))) as Record<string, unknown>
  return { status: response.status, headers: response.headers, json }
}

/** Runs SQL against the same local database the Worker uses. For moving clocks in tests. */
export const sql = (command: string): Record<string, unknown>[] => {
  const out = execFileSync(
    'pnpm',
    [
      'exec',
      'wrangler',
      'd1',
      'execute',
      'securepass',
      '--local',
      '--persist-to',
      inject('persistDir'),
      '--json',
      '--command',
      command,
    ],
    { encoding: 'utf8', env: { ...process.env, CI: '1' }, stdio: ['ignore', 'pipe', 'ignore'] },
  )
  const parsed = JSON.parse(out.slice(out.indexOf('['))) as { results: Record<string, unknown>[] }[]
  return parsed[0]?.results ?? []
}

/** The one account every API test shares, with the secrets a real client would hold. */
export const account = {
  id: randomUUID(),
  email: 'owner@example.com',
  authKey: randomKey(),
  recoveryAuthKey: randomKey(),
  kdfSalt: randomKey(16),
  wrappedVaultKey: randomKey(73),
  wrappedVaultKeyRecovery: randomKey(73),
  totpSecret: new Uint8Array(),
  recoveryCodes: [] as string[],
}

export const setupBody = () => ({
  account_id: account.id,
  email: account.email,
  kdf: FLOOR,
  kdf_salt: account.kdfSalt,
  auth_key: account.authKey,
  recovery_auth_key: account.recoveryAuthKey,
  wrapped_vault_key: account.wrappedVaultKey,
  wrapped_vault_key_recovery: account.wrappedVaultKeyRecovery,
  device_name: 'Test device',
})

export const SETUP_TOKEN = TEST_VARS.SETUP_TOKEN

export const rememberTotp = (otpauthUri: string, recoveryCodes: string[]): void => {
  account.totpSecret = secretFromOtpauthUri(otpauthUri) ?? new Uint8Array()
  account.recoveryCodes = recoveryCodes
}

/** The TOTP code for the current time step, with no reset of the server's reuse guard. */
export const currentCode = (): Promise<string> =>
  totpCode(account.totpSecret, totpStep(Math.floor(Date.now() / 1000)))

/** A code the server will accept now: clears the reuse guard first, then makes the current code. */
export const freshCode = (): Promise<string> => {
  sql('UPDATE account SET totp_last_step = NULL')
  return currentCode()
}

/** Signs in as a new device and returns its token. */
export const login = async (deviceName = 'Second device'): Promise<string> => {
  const totp = account.totpSecret.length > 0 ? { totp_code: await freshCode() } : {}
  const reply = await call('/api/auth/login', {
    body: { email: account.email, auth_key: account.authKey, device_name: deviceName, ...totp },
  })
  if (reply.status !== 200) throw new Error(`login failed with ${reply.status}`)
  return reply.json.token as string
}

/** Writes an item and returns the server's reply. */
export const putItem = (
  token: string,
  id: string,
  baseRevision: number,
  trashed = false,
  ciphertext = randomKey(120),
) =>
  call(`/api/items/${id}`, {
    method: 'PUT',
    token,
    headers: { 'If-Match': String(baseRevision) },
    body: { ciphertext, trashed },
  })

export const sync = (token: string, since = 0) =>
  call(`/api/sync?since=${since}`, { method: 'GET', token })
