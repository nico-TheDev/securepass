import { Hono } from 'hono'
import type { AppEnv } from './app-env'
import { authRoutes } from './auth/routes'
import { itemRoutes } from './items/routes'
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

const authed = new Hono<AppEnv>()
authed.use('*', bearerAuth)
authed.route('/', itemRoutes)
authed.route('/', syncRoutes)
app.route('/api', authed)

app.notFound((c) => c.json({ error: 'not_found' }, 404))
app.onError((error, c) => {
  // Only the error name: messages can echo request data.
  log('error', 'unhandled_error', { name: error.name })
  return c.json({ error: 'internal_error' }, 500)
})

export default app
