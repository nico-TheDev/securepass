/** A success value or an expected failure. Expected failures are returned, never thrown. */
export type Result<T, E> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E }

/**
 * Wraps a success value.
 * @param value - The value to return.
 */
export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value })

/**
 * Wraps an expected failure.
 * @param error - The error describing what went wrong.
 */
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error })
