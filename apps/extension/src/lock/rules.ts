/** The extension locks when its last activity is this old. */
export const LOCK_AFTER_MS = 15 * 60 * 1000

/** Wrong PINs allowed before the PIN unlock is removed. */
export const MAX_PIN_FAILURES = 5

/**
 * True when the vault should lock: there is no recorded activity, or the last one is 15 minutes old.
 * @param lastActivityAt - `last_activity_at` from session storage, in milliseconds.
 */
export const shouldLock = (lastActivityAt: number | undefined, now: number): boolean =>
  lastActivityAt === undefined || now - lastActivityAt >= LOCK_AFTER_MS

/**
 * What a wrong PIN leads to: one more failure, and at 5 the PIN unlock is removed so only the
 * master password works.
 * @param failures - Wrong PINs so far, counting this one.
 */
export const pinFailureOutcome = (
  failures: number,
): { readonly remove: boolean; readonly left: number } => ({
  remove: failures >= MAX_PIN_FAILURES,
  left: Math.max(0, MAX_PIN_FAILURES - failures),
})
