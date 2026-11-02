import {
  err,
  type LoginRequest,
  type LoginResponse,
  loginResponseSchema,
  ok,
  type PreloginResponse,
  preloginResponseSchema,
  type Result,
  type SetupRequest,
  type SetupResponse,
  setupResponseSchema,
} from '@securepass/shared'
import type { z } from 'zod'
import { env } from '../env'

/** Why an auth call failed: no reply at all, or a reply the app can read a status and code from. */
export type ApiError =
  | { readonly kind: 'network' }
  | { readonly kind: 'status'; readonly status: number; readonly code?: string }

const post = async <S extends z.ZodType>(
  path: string,
  body: unknown,
  schema: S,
  headers: Record<string, string> = {},
): Promise<Result<z.infer<S>, ApiError>> => {
  let response: Response
  try {
    response = await fetch(`${env.VITE_API_URL}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
    })
  } catch {
    return err({ kind: 'network' })
  }
  const json: unknown = await response.json().catch(() => null)
  if (!response.ok) {
    const code = (json as { code?: unknown; error?: unknown } | null)?.code
    const error = (json as { error?: unknown } | null)?.error
    const text = typeof code === 'string' ? code : typeof error === 'string' ? error : undefined
    return err(
      text === undefined
        ? { kind: 'status', status: response.status }
        : { kind: 'status', status: response.status, code: text },
    )
  }
  const parsed = schema.safeParse(json)
  return parsed.success ? ok(parsed.data) : err({ kind: 'status', status: 502 })
}

/** `POST /api/setup`, carrying the one time setup token. */
export const postSetup = (
  setupToken: string,
  request: SetupRequest,
): Promise<Result<SetupResponse, ApiError>> =>
  post('/api/setup', request, setupResponseSchema, { 'X-Setup-Token': setupToken })

/** `POST /api/auth/prelogin`: the KDF settings and salt for an email. */
export const postPrelogin = (email: string): Promise<Result<PreloginResponse, ApiError>> =>
  post('/api/auth/prelogin', { email }, preloginResponseSchema)

/** `POST /api/auth/login`. */
export const postLogin = (request: LoginRequest): Promise<Result<LoginResponse, ApiError>> =>
  post('/api/auth/login', request, loginResponseSchema)
