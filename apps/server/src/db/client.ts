import { drizzle } from 'drizzle-orm/d1'
import * as schema from './schema'

/**
 * Makes the Drizzle client for one request.
 * @param binding - The D1 binding.
 */
export const createDb = (binding: D1Database) => drizzle(binding, { schema })

/** The Drizzle client type. */
export type Db = ReturnType<typeof createDb>
