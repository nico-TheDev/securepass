import { z } from 'zod'

const envSchema = z.object({
  /** API origin. Empty means the page and the API share one origin, which is the deployed setup. */
  VITE_API_URL: z
    .string()
    .default('')
    .transform((value) => value.replace(/\/+$/, '')),
})

const parsed = envSchema.safeParse(import.meta.env)
if (!parsed.success) throw new Error('Invalid environment: VITE_API_URL must be a string')

/** Validated build time settings. Parsed once at startup so a bad value fails fast. */
export const env = parsed.data
