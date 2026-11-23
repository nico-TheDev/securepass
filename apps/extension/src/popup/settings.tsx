import { type FormEvent, useState } from 'react'
import { env } from '../env'
import { PIN_MIN_LENGTH, removePin, setPin } from '../lock/pin'
import type { UnlockMethod } from '../session-store'
import { PasswordField } from './fields'

type Props = {
  readonly vaultKey: Uint8Array
  readonly email: string
  /** How this session was unlocked. A PIN can only be set after a master password unlock. */
  readonly method: UnlockMethod
  readonly pinSet: boolean
  readonly onPinChange: () => void
  readonly onSignOut: () => void
}

/** The PIN for this browser session, and signing this extension out. */
export function Settings({ vaultKey, email, method, pinSet, onPinChange, onSignOut }: Props) {
  const [pin, setPinText] = useState('')
  const [working, setWorking] = useState(false)
  const [message, setMessage] = useState<{ readonly bad: boolean; readonly text: string } | null>(
    null,
  )

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setMessage(null)
    setWorking(true)
    const result = await setPin(pin, vaultKey)
    setWorking(false)
    setPinText('')
    if (result.ok) {
      setMessage({ bad: false, text: 'PIN set. It works until you close the browser.' })
      onPinChange()
    } else {
      setMessage({
        bad: true,
        text:
          result.error === 'too_short'
            ? `A PIN needs at least ${PIN_MIN_LENGTH} characters.`
            : 'The PIN could not be set.',
      })
    }
  }

  return (
    <>
      <section className="panel" aria-labelledby="pin-title">
        <h2 id="pin-title">PIN unlock</h2>
        <p className="muted">
          A PIN unlocks this extension again until you close the browser. It needs at least{' '}
          {PIN_MIN_LENGTH} characters, and letters are allowed. After 5 wrong PINs it is removed and
          only your master password works.
        </p>
        {method === 'password' ? (
          <form className="form" onSubmit={submit} aria-busy={working}>
            <PasswordField
              label={pinSet ? 'New PIN' : 'PIN'}
              value={pin}
              onChange={setPinText}
              autoComplete="off"
              disabled={working}
            />
            <div className="actions">
              <button className="btn btn-primary" type="submit" disabled={working || pin === ''}>
                {working ? 'Setting…' : pinSet ? 'Change PIN' : 'Set PIN'}
              </button>
              {pinSet ? (
                <button
                  className="btn"
                  type="button"
                  disabled={working}
                  onClick={() =>
                    void removePin().then(() => {
                      setMessage({ bad: false, text: 'PIN removed.' })
                      onPinChange()
                    })
                  }
                >
                  Remove PIN
                </button>
              ) : null}
            </div>
          </form>
        ) : (
          <p className="notice">
            You unlocked with the PIN. Lock and unlock with your master password to change or remove
            it.
          </p>
        )}
        <p className={message?.bad ? 'notice notice-error' : message ? 'notice' : ''} role="status">
          {message?.text ?? ''}
        </p>
      </section>
      <section className="panel" aria-labelledby="account-title">
        <h2 id="account-title">This device</h2>
        <p className="muted">
          Signed in as {email} on {new URL(env.serverUrl).host}. Signing out removes the encrypted
          copy of your vault from this extension. Edits that have not synced yet are lost.
        </p>
        <div className="actions">
          <a className="btn" href={env.serverUrl} target="_blank" rel="noreferrer">
            Open the web vault
          </a>
          <button className="btn btn-danger" type="button" onClick={onSignOut}>
            Sign out
          </button>
        </div>
      </section>
    </>
  )
}
