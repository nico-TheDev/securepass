import { cors } from 'hono/cors'
import { createMiddleware } from 'hono/factory'
import type { AppEnv } from '../app-env'
import { log } from '../lib/logger'

const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self'",
  "connect-src 'self' https://api.pwnedpasswords.com",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
].join('; ')

/** Adds the security headers from spec 0002 to every response. */
export const securityHeaders = createMiddleware<AppEnv>(async (c, next) => {
  await next()
  c.header('Content-Security-Policy', CSP)
  c.header('Strict-Transport-Security', 'max-age=63072000; includeSubDomains')
  c.header('X-Content-Type-Options', 'nosniff')
  c.header('Referrer-Policy', 'no-referrer')
  c.header('Cache-Control', 'no-store')
})

/** CORS for the extension origins in `ALLOWED_ORIGINS`. The web vault is same origin. */
export const corsMiddleware = createMiddleware<AppEnv>((c, next) =>
  cors({
    origin: (origin) => (c.var.config.allowedOrigins.includes(origin) ? origin : null),
    allowHeaders: ['Authorization', 'Content-Type', 'If-Match', 'X-Setup-Token'],
    allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    maxAge: 600,
  })(c, next),
)

/** Logs method, path, status, and duration. Never headers, bodies, or query strings. */
export const requestLog = createMiddleware<AppEnv>(async (c, next) => {
  const started = Date.now()
  await next()
  log('info', 'request', {
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    status: c.res.status,
    ms: Date.now() - started,
  })
})
