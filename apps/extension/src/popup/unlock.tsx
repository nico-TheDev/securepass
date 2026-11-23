import type { Cache, CacheMeta } from '@securepass/shared/cache'
import { unlockWithPassword } from '@securepass/vault'
import { type FormEvent, useState } from 'react'
import { unlockWithPin } from '../lock/pin'
import type { UnlockMethod } from '../session-store'
import { PasswordField } from './fields'

type Props = {
  readonly cache: Cache
  readonly meta: CacheMeta
  /** True when a PIN can unlock in this browser session. */
  readonly pinAvailable: boolean
  readonly onUnlocked: (vaultKey: Uint8Array, method: UnlockMethod) => void
  /** Called when the PIN unlock was removed, so the screen falls back to the master password. */
  readonly onPinRemoved: () => void
}

/** Unlock from the local copy, with the master password or this session's PIN. No server call. */
export function Unlock({ cache, meta, pinAvailable, onUnlocked, onPinRemoved }: Props) {
  const [usePin, setUsePin] = useState(pinAvailable)
  const [secret, setSecret] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const pinMode = usePin && pinAvailable

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(null)
    setWorking(true)
    const typed = secret
    setSecret('')
    if (pinMode) {
      const result = await unlockWithPin(typed)
      setWorking(false)
      if (result.ok) return onUnlocked(result.value, 'pin')
      if (result.error.kind === 'wrong') {
        return setError(`That PIN did not unlock the vault. ${result.error.left} tries left.`)
      }
      onPinRemoved()
      setUsePin(false)
      return setError(
        result.error.kind === 'removed'
          ? 'Too many wrong PINs. The PIN was removed. Use your master password.'
          : 'No PIN is set for this browser session. Use your master password.',
      )
    }
    const result = await unlockWithPassword(cache, meta, typed)
    setWorking(false)
    if (result.ok) onUnlocked(result.value.vaultKey, 'password')
    else {
      setError(
        result.error.kind === 'wrong_password'
          ? 'That password did not unlock the vault.'
          : 'The saved settings were refused, so nothing was unlocked.',
      )
    }
  }

  return (
    <main className="screen">
      <h1>Unlock your vault</h1>
      <p className="muted">{meta.email}</p>
      <form className="form" onSubmit={submit} aria-busy={working}>
        <input
          className="visually-hidden"
          type="text"
          autoComplete="username"
          value={meta.email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <PasswordField
          key={pinMode ? 'pin' : 'password'}
          label={pinMode ? 'PIN' : 'Master password'}
          value={secret}
          onChange={setSecret}
          autoComplete={pinMode ? 'off' : 'current-password'}
          required
          autoFocus
          disabled={working}
        />
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        {working ? <div className="progress" aria-hidden="true" /> : null}
        <button className="btn btn-primary" type="submit" disabled={working || secret === ''}>
          {working ? 'Unlocking…' : 'Unlock'}
        </button>
        {pinAvailable ? (
          <button
            className="btn btn-quiet"
            type="button"
            disabled={working}
            onClick={() => {
              setUsePin((current) => !current)
              setSecret('')
              setError(null)
            }}
          >
            {pinMode ? 'Use the master password instead' : 'Use the PIN instead'}
          </button>
        ) : null}
      </form>
    </main>
  )
}
