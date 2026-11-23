/** The server a development build talks to when `WXT_SERVER_URL` is not set. */
export const DEV_SERVER_URL = 'http://localhost:8787'

/** The checked server origin, or why the build setting was refused. */
export type ServerUrlResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly error: string }

const isLocal = (hostname: string): boolean => hostname === 'localhost' || hostname === '127.0.0.1'

/**
 * Checks the build time `WXT_SERVER_URL`. The server origin is fixed when the extension is built,
 * because the manifest's host permissions need it. It must be `https`, except for a local server.
 * This file has no imports so the WXT config can load it.
 * @param value - The raw setting.
 * @param production - True for a production build, where the setting is required.
 * @returns The origin with no trailing slash.
 */
export const parseServerUrl = (value: string | undefined, production: boolean): ServerUrlResult => {
  const text = (value ?? '').trim()
  if (text === '') {
    return production
      ? {
          ok: false,
          error: 'WXT_SERVER_URL is not set. Put your server origin in apps/extension/.env',
        }
      : { ok: true, value: DEV_SERVER_URL }
  }
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return { ok: false, error: `WXT_SERVER_URL is not a URL: ${text}` }
  }
  const secure = url.protocol === 'https:' || (url.protocol === 'http:' && isLocal(url.hostname))
  if (!secure)
    return { ok: false, error: 'WXT_SERVER_URL must use https (http only for localhost)' }
  return { ok: true, value: url.origin }
}
