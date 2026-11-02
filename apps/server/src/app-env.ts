import type { Config } from './env'

/** What a request handler can read from the Hono context. */
export type AppEnv = {
  Bindings: CloudflareBindings
  Variables: {
    config: Config
    accountId: string
    sessionId: string
  }
}
