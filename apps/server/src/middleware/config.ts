import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../app-env'
import { parseConfig } from '../env'
import { log } from '../lib/logger'

/** Validates bindings and secrets on every request; answers 500 until they are right. */
export const configMiddleware = createMiddleware<AppEnv>(async (c, next) => {
  const config = parseConfig(c.env)
  if (!config.ok) {
    log('error', 'config_invalid', { detail: config.error })
    return c.json({ error: 'server_misconfigured' }, 500)
  }
  c.set('config', config.value)
  await next()
})
