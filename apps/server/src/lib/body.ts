import { err, ok, type Result } from '@securepass/shared'
import type { Context } from 'hono'
import type { ZodType } from 'zod'
import type { AppEnv } from '../app-env'

/**
 * Reads the JSON body and checks it against a zod schema from `packages/shared`.
 * A body that is not JSON or does not match is an expected failure, returned not thrown.
 * @param c - The request context.
 * @param schema - The schema the body must satisfy.
 */
export const parseBody = async <T>(
  c: Context<AppEnv>,
  schema: ZodType<T>,
): Promise<Result<T, 'invalid_request'>> => {
  const json: unknown = await c.req.json().catch(() => null)
  const parsed = schema.safeParse(json)
  return parsed.success ? ok(parsed.data) : err('invalid_request')
}
