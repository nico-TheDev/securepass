import { Hono } from 'hono'
import { accountRoutes, passwordRoute } from './account/routes'
import type { AppEnv } from './app-env'
import { authRoutes } from './auth/routes'
import { runDailyPurge } from './cron/purge'
import { deviceRoutes } from './devices/routes'
import { itemRoutes } from './items/routes'
import { nowSeconds } from './lib/http'
import { log } from './lib/logger'
import { bearerAuth } from './middleware/bearer'
import { configMiddleware } from './middleware/config'
import { corsMiddleware, requestLog, securityHeaders } from './middleware/security'
import { syncRoutes } from './sync/routes'

const app = new Hono<AppEnv>()

app.use('*', securityHeaders)
app.use('*', requestLog)
app.get('/api/health', (c) => c.json({ ok: true }))
app.use('/api/*', configMiddleware)
app.use('/api/*', corsMiddleware)

app.route('/api', authRoutes)
app.route('/api', passwordRoute)

const authed = new Hono<AppEnv>()
authed.use('*', bearerAuth)
authed.route('/', accountRoutes)
authed.route('/', deviceRoutes)
authed.route('/', itemRoutes)
authed.route('/', syncRoutes)
app.route('/api', authed)

app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404))

// Everything else is the web vault: static files, served through the Worker so they carry the
// same security headers as the API.
app.notFound((c) =>
  c.env.ASSETS ? c.env.ASSETS.fetch(c.req.raw) : c.json({ error: 'not_found' }, 404),
)
app.onError((error, c) => {
  // Only the error name: messages can echo request data.
  log('error', 'unhandled_error', { name: error.name })
  return c.json({ error: 'internal_error' }, 500)
})

export default {
  fetch: app.fetch,
  /** The daily Cron Trigger: trash purge, tombstone cleanup, and attempt log cleanup. */
  scheduled: async (_controller, env) => {
    await runDailyPurge(env.DB, nowSeconds())
  },
} satisfies ExportedHandler<CloudflareBindings>
