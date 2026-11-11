import type { Cache, CacheMeta } from '@securepass/shared/cache'
import { reauthenticate } from '@securepass/vault'
import { type FormEvent, useState } from 'react'
import { Dialog } from '../ui/dialog'
import { signInErrorText } from '../ui/errors'
import { PasswordField, TextField } from '../ui/text-field'
import { TotpField } from '../ui/totp-dialog'
import { api } from './api'
import { DEVICE_NAME } from './vault-session'

type Props = {
  readonly open: boolean
  readonly cache: Cache
  readonly onClose: () => void
  /** Called with the cache record that holds the new device token. */
  readonly onSignedIn: (meta: CacheMeta) => void
}

/**
 * Shown when the session expired. Logging in again keeps the local copy and every queued edit;
 * the queue is sent as soon as the new session starts.
 */
export function ReauthDialog({ open, cache, onClose, onSignedIn }: Props) {
  return (
    <Dialog open={open} title="Sign in again" onClose={onClose}>
      <ReauthForm cache={cache} onClose={onClose} onSignedIn={onSignedIn} />
    </Dialog>
  )
}

function ReauthForm({ cache, onClose, onSignedIn }: Omit<Props, 'open'>) {
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    setWorking(true)
    const result = await reauthenticate(
      api,
      cache,
      password,
      useRecoveryCode ? { recovery_code: code } : { totp_code: code },
      DEVICE_NAME,
    )
    setWorking(false)
    setPassword('')
    setCode('')
    if (result.ok) {
      onSignedIn(result.value)
      onClose()
    } else setError(signInErrorText(result.error))
  }

  return (
    <form className="form" onSubmit={submit}>
      <p>
        Your session on the server has ended. Your vault and your unsent changes are still on this
        device. Sign in again to sync them.
      </p>
      <PasswordField
        label="Master password"
        value={password}
        onChange={setPassword}
        autoComplete="current-password"
        required
        autoFocus
        disabled={working}
      />
      {useRecoveryCode ? (
        <TextField
          label="Recovery code"
          value={code}
          onChange={setCode}
          autoComplete="off"
          disabled={working}
        />
      ) : (
        <TotpField value={code} onChange={setCode} disabled={working} />
      )}
      <button
        className="btn btn-quiet btn-inline"
        type="button"
        onClick={() => {
          setUseRecoveryCode((current) => !current)
          setCode('')
        }}
      >
        {useRecoveryCode ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
      </button>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button className="btn" type="button" onClick={onClose} disabled={working}>
          Not now
        </button>
        <button className="btn btn-primary" type="submit" disabled={working || password === ''}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
      </div>
    </form>
  )
}
