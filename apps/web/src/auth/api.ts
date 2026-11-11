import type {
  LoginRequest,
  LoginResponse,
  PreloginResponse,
  Result,
  SetupRequest,
  SetupResponse,
} from '@securepass/shared'
import { type ApiError, createApiClient } from '@securepass/vault'
import { env } from '../env'

export type { ApiError } from '@securepass/vault'

/** The typed client for this vault's server. Same origin when `VITE_API_URL` is empty. */
export const api = createApiClient(env.VITE_API_URL)

/** `POST /api/setup`, carrying the one time setup token. */
export const postSetup = (
  setupToken: string,
  request: SetupRequest,
): Promise<Result<SetupResponse, ApiError>> => api.setup(setupToken, request)

/** `POST /api/auth/prelogin`: the KDF settings and salt for an email. */
export const postPrelogin = (email: string): Promise<Result<PreloginResponse, ApiError>> =>
  api.prelogin(email)

/** `POST /api/auth/login`. */
export const postLogin = (request: LoginRequest): Promise<Result<LoginResponse, ApiError>> =>
  api.login(request)
