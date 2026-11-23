import { parseServerUrl } from './server-url'

const parsed = parseServerUrl(import.meta.env.WXT_SERVER_URL, import.meta.env.MODE === 'production')
if (!parsed.ok) throw new Error(parsed.error)

/** Validated build time settings. Parsed once at startup so a bad value fails fast. */
export const env = {
  /** The sync server origin, with no trailing slash. */
  serverUrl: parsed.value,
} as const
