import {
  type Device,
  devicesResponseSchema,
  err,
  type LoginRequest,
  type LoginResponse,
  loginResponseSchema,
  ok,
  type PasswordRequest,
  type PasswordResponse,
  type PreloginResponse,
  passwordResponseSchema,
  preloginResponseSchema,
  type RecoverRequest,
  type RecoverResponse,
  type Result,
  recoverResponseSchema,
  type SetupRequest,
  type SetupResponse,
  setupResponseSchema,
  type TotpEnrollResponse,
  totpEnrollResponseSchema,
} from '@securepass/shared'
import type { z } from 'zod'

/** Why an API call failed: no reply at all, or a reply the app can read a status and code from. */
export type ApiError =
  | { readonly kind: 'network' }
  | {
      readonly kind: 'status'
      readonly status: number
      /** The server's `code` (on a 401) or `error` text. */
      readonly code?: string
      /** Seconds to wait, from `Retry-After` on a 429. */
      readonly retryAfter?: number
    }

type RequestOptions = {
  readonly method?: 'GET' | 'POST' | 'PUT' | 'DELETE'
  readonly body?: unknown
  readonly token?: string | undefined
  readonly headers?: Record<string, string>
}

/**
 * Makes the typed client for one server.
 * @param baseUrl - API origin with no trailing slash. Empty for same origin.
 * @param fetcher - `fetch`, injectable for tests. The default looks `fetch` up at call time.
 */
export const createApiClient = (
  baseUrl: string,
  fetcher: typeof fetch = (input, init) => fetch(input, init),
) => {
  const request = async <S extends z.ZodType>(
    path: string,
    schema: S | null,
    { method = 'POST', body, token, headers = {} }: RequestOptions = {},
  ): Promise<Result<z.infer<S>, ApiError>> => {
    let response: Response
    try {
      response = await fetcher(`${baseUrl}${path}`, {
        method,
        headers: {
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          ...(token === undefined ? {} : { Authorization: `Bearer ${token}` }),
          ...headers,
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
    } catch {
      return err({ kind: 'network' })
    }
    const json: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const code = (json as { code?: unknown } | null)?.code
      const error = (json as { error?: unknown } | null)?.error
      const text = typeof code === 'string' ? code : typeof error === 'string' ? error : undefined
      const retryAfter = Number(response.headers?.get?.('Retry-After') ?? Number.NaN)
      return err({
        kind: 'status',
        status: response.status,
        ...(text === undefined ? {} : { code: text }),
        ...(Number.isFinite(retryAfter) && response.status === 429 ? { retryAfter } : {}),
      })
    }
    if (schema === null) return ok(undefined as z.infer<S>)
    const parsed = schema.safeParse(json)
    return parsed.success ? ok(parsed.data) : err({ kind: 'status', status: 502 })
  }

  /** A call whose success reply has no body (a 204). */
  const requestVoid = async (
    path: string,
    options: RequestOptions,
  ): Promise<Result<void, ApiError>> => {
    const reply = await request(path, null, options)
    return reply.ok ? ok(undefined) : reply
  }

  const totpBody = (totpCode: string | undefined) =>
    totpCode === undefined || totpCode === '' ? {} : { totp_code: totpCode }

  return {
    /** `POST /api/setup`, carrying the one time setup token. */
    setup: (setupToken: string, body: SetupRequest): Promise<Result<SetupResponse, ApiError>> =>
      request('/api/setup', setupResponseSchema, {
        body,
        headers: { 'X-Setup-Token': setupToken },
      }),
    /** `POST /api/auth/prelogin`: the KDF settings and salt for an email. */
    prelogin: (email: string): Promise<Result<PreloginResponse, ApiError>> =>
      request('/api/auth/prelogin', preloginResponseSchema, { body: { email } }),
    /** `POST /api/auth/login`. */
    login: (body: LoginRequest): Promise<Result<LoginResponse, ApiError>> =>
      request('/api/auth/login', loginResponseSchema, { body }),
    /** `POST /api/auth/recover`: trades the recovery proof for a short lived recovery token. */
    recover: (body: RecoverRequest): Promise<Result<RecoverResponse, ApiError>> =>
      request('/api/auth/recover', recoverResponseSchema, { body }),
    /** `POST /api/auth/logout`: revokes this device's session. */
    logout: (token: string): Promise<Result<void, ApiError>> =>
      requestVoid('/api/auth/logout', { token }),
    /** `POST /api/account/totp`: starts enrollment. A 409 means TOTP is already on. */
    totpEnroll: (token: string): Promise<Result<TotpEnrollResponse, ApiError>> =>
      request('/api/account/totp', totpEnrollResponseSchema, { token }),
    /** `POST /api/account/totp/confirm`. */
    totpConfirm: (token: string, totpCode: string): Promise<Result<void, ApiError>> =>
      requestVoid('/api/account/totp/confirm', { token, body: { totp_code: totpCode } }),
    /** `POST /api/account/password`, signed in (token) or with a recovery token in the body. */
    changePassword: (
      token: string | undefined,
      body: PasswordRequest,
    ): Promise<Result<PasswordResponse, ApiError>> =>
      request('/api/account/password', passwordResponseSchema, { token, body }),
    /** `GET /api/devices`. */
    devices: async (token: string): Promise<Result<readonly Device[], ApiError>> => {
      const reply = await request('/api/devices', devicesResponseSchema, { method: 'GET', token })
      return reply.ok ? ok(reply.value.devices) : reply
    },
    /** `DELETE /api/devices/:id` with a fresh TOTP code. */
    revokeDevice: (
      token: string,
      id: string,
      totpCode: string | undefined,
    ): Promise<Result<void, ApiError>> =>
      requestVoid(`/api/devices/${id}`, { method: 'DELETE', token, body: totpBody(totpCode) }),
    /** `DELETE /api/items/:id` with a fresh TOTP code: a permanent delete. */
    deleteItem: (
      token: string,
      id: string,
      baseRevision: number,
      totpCode: string | undefined,
    ): Promise<Result<void, ApiError>> =>
      requestVoid(`/api/items/${id}`, {
        method: 'DELETE',
        token,
        body: totpBody(totpCode),
        headers: { 'If-Match': String(baseRevision) },
      }),
    /** `DELETE /api/trash` with a fresh TOTP code: purges every trashed item. */
    emptyTrash: (token: string, totpCode: string | undefined): Promise<Result<void, ApiError>> =>
      requestVoid('/api/trash', { method: 'DELETE', token, body: totpBody(totpCode) }),
  }
}

/** The typed client for one server. */
export type ApiClient = ReturnType<typeof createApiClient>
