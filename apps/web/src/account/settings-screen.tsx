import type { Cache } from '@securepass/shared/cache'
import { changeMasterPassword } from '@securepass/vault'
import { type FormEvent, useMemo, useState } from 'react'
import { api } from '../auth/api'
import { measureStrength } from '../auth/strength'
import { StrengthMeter } from '../auth/strength-meter'
import type { Session } from '../auth/vault-session'
import { signInErrorText } from '../ui/errors'
import { PasswordField } from '../ui/text-field'
import { TotpField } from '../ui/totp-dialog'

type Props = {
  readonly cache: Cache
  readonly session: Session
  /** Called with the session that holds this device's new token and settings. */
  readonly onSessionChange: (session: Session) => void
  /** Opens the recovery flow, for a forgotten master password. */
  readonly onRecover: () => void
}

/** Change the master password, or start a recovery with the recovery kit. */
export function SettingsScreen({ cache, session, onSessionChange, onRecover }: Props) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const strength = useMemo(
    () => measureStrength(next, session.meta.email),
    [next, session.meta.email],
  )
  const mismatch = confirm !== '' && confirm !== next

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (next === '' || next !== confirm) return
    setError(null)
    setDone(false)
    setWorking(true)
    const result = await changeMasterPassword(api, cache, session, current, next, code)
    setWorking(false)
    setCurrent('')
    setNext('')
    setConfirm('')
    setCode('')
    if (result.ok) {
      setDone(true)
      onSessionChange(result.value)
    } else {
      setError(
        result.error.kind === 'wrong_credentials'
          ? 'The current master password or the code was not accepted. Nothing was changed.'
          : signInErrorText(result.error),
      )
    }
  }

  return (
    <div className="page">
      <h1>Settings</h1>
      <section className="panel" aria-labelledby="password-title">
        <h2 id="password-title">Change master password</h2>
        <p>
          Your vault key is wrapped again under the new password and every other device is signed
          out. Your items are not changed. Your recovery kit keeps working.
        </p>
        <form className="form" onSubmit={submit} aria-busy={working}>
          <input
            className="visually-hidden"
            type="text"
            name="username"
            autoComplete="username"
            value={session.meta.email}
            readOnly
            tabIndex={-1}
            aria-hidden="true"
          />
          <PasswordField
            label="Current master password"
            value={current}
            onChange={setCurrent}
            autoComplete="current-password"
            required
            disabled={working}
          />
          <PasswordField
            label="New master password"
            value={next}
            onChange={setNext}
            autoComplete="new-password"
            required
            disabled={working}
          >
            <StrengthMeter strength={strength} empty={next === ''} />
          </PasswordField>
          <PasswordField
            label="Confirm new master password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            required
            disabled={working}
            error={mismatch ? 'The two passwords do not match.' : undefined}
          />
          <TotpField value={code} onChange={setCode} disabled={working} />
          {error ? (
            <p className="notice notice-error" role="alert">
              {error}
            </p>
          ) : null}
          {working ? <div className="progress" aria-hidden="true" /> : null}
          <p role="status">
            {done ? 'Master password changed. Every other device was signed out.' : ''}
          </p>
          <div className="kit-actions">
            <button
              className="btn btn-primary"
              type="submit"
              disabled={working || mismatch || current === '' || next === ''}
            >
              {working ? 'Changing…' : 'Change master password'}
            </button>
          </div>
        </form>
      </section>
      <section className="panel" aria-labelledby="recover-title">
        <h2 id="recover-title">Recover with your recovery kit</h2>
        <p>
          If you no longer know your master password, the recovery key from your kit plus an
          authenticator or recovery code lets you set a new one. You get a new kit and the old one
          stops working.
        </p>
        <div className="kit-actions">
          <button className="btn" type="button" onClick={onRecover}>
            Start recovery
          </button>
        </div>
      </section>
    </div>
  )
}
