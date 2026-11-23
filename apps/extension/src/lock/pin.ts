import { PIN_MIN_LENGTH, unwrapWithPin, wrapWithPin } from '@securepass/crypto'
import { err, ok, type Result } from '@securepass/shared'
import { readDeviceId } from '../local-store'
import { readSession, removeSession, writeSession } from '../session-store'
import { pinFailureOutcome } from './rules'

export { PIN_MIN_LENGTH }

/** Why a PIN unlock failed. */
export type PinUnlockError =
  | { readonly kind: 'no_pin' }
  /** Wrong PIN, with the number of tries left. */
  | { readonly kind: 'wrong'; readonly left: number }
  /** The fifth wrong PIN: the PIN unlock was removed, only the master password works now. */
  | { readonly kind: 'removed' }

/** True when a PIN can unlock in this browser session. */
export const hasPin = async (): Promise<boolean> => {
  const { pin_wrapped_vault_key, pin_salt } = await readSession('pin_wrapped_vault_key', 'pin_salt')
  return Boolean(pin_wrapped_vault_key && pin_salt)
}

/** Removes the PIN unlock and its failure counter. */
export const removePin = (): Promise<void> =>
  removeSession('pin_wrapped_vault_key', 'pin_salt', 'pin_failures')

/**
 * Sets a PIN for this browser session. Runs Argon2id, so it is called from the popup only.
 * The wrap lives in memory and never survives a browser restart.
 * @param pin - At least 6 characters. Letters are allowed.
 */
export const setPin = async (
  pin: string,
  vaultKey: Uint8Array,
): Promise<Result<void, 'too_short' | 'crypto'>> => {
  if ([...pin.normalize('NFC')].length < PIN_MIN_LENGTH) return err('too_short')
  const wrap = await wrapWithPin(pin, vaultKey, await readDeviceId())
  if (!wrap.ok) return err('crypto')
  await writeSession({ ...wrap.value, pin_failures: 0 })
  return ok(undefined)
}

/**
 * Unlocks with the PIN. The attempt is counted before Argon2id runs, so closing the popup cannot
 * dodge the counter. After 5 failures the PIN wrap and the counter are deleted.
 * @returns The vault key.
 */
export const unlockWithPin = async (pin: string): Promise<Result<Uint8Array, PinUnlockError>> => {
  const stored = await readSession('pin_wrapped_vault_key', 'pin_salt', 'pin_failures')
  if (!stored.pin_wrapped_vault_key || !stored.pin_salt) return err({ kind: 'no_pin' })
  const failures = (stored.pin_failures ?? 0) + 1
  await writeSession({ pin_failures: failures })

  const opened = await unwrapWithPin(
    pin,
    { pin_wrapped_vault_key: stored.pin_wrapped_vault_key, pin_salt: stored.pin_salt },
    await readDeviceId(),
  )
  if (opened.ok) {
    await writeSession({ pin_failures: 0 })
    return ok(opened.value)
  }
  const outcome = pinFailureOutcome(failures)
  if (!outcome.remove) return err({ kind: 'wrong', left: outcome.left })
  await removePin()
  return err({ kind: 'removed' })
}
