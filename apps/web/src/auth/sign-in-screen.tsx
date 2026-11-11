import type { Cache } from '@securepass/shared/cache'
import { type FormEvent, useState } from 'react'
import { signInErrorText } from '../ui/errors'
import { PasswordField, TextField } from '../ui/text-field'
import { TotpField } from '../ui/totp-dialog'
import { AuthShell } from './auth-shell'
import { type Session, type SignInError, signIn } from './vault-session'

type Props = {
  readonly cache: Cache
  readonly onSignedIn: (session: Session) => void
  readonly onSetup: () => void
  readonly onRecover?: () => void
}

/** For a device with no local copy yet: ask the server for the KDF settings, then derive and prove here. */
export function SignInScreen({ cache, onSignedIn, onSetup, onRecover }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<SignInError | undefined>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    setWorking(true)
    const result = await signIn(
      cache,
      email,
      password,
      useRecoveryCode ? { recovery_code: code } : { totp_code: code },
    )
    setWorking(false)
    setPassword('')
    setCode('')
    if (result.ok) onSignedIn(result.value)
    else setError(result.error)
  }

  return (
    <AuthShell>
      <form className="card" onSubmit={submit} aria-busy={working}>
        <div className="card-head">
          <h1>Sign in to your vault</h1>
          <p>This device has no copy of your vault yet, so it will download one.</p>
        </div>
        <p className="notice">Sign in here only on devices you trust.</p>
        <div className="form">
          <TextField
            label="Email"
            type="email"
            value={email}
            onChange={setEmail}
            autoComplete="username"
            required
            autoFocus
            disabled={working}
          />
          <PasswordField
            label="Master password"
            value={password}
            onChange={setPassword}
            autoComplete="current-password"
            required
            disabled={working}
          />
          {useRecoveryCode ? (
            <TextField
              label="Recovery code"
              value={code}
              onChange={setCode}
              autoComplete="off"
              disabled={working}
              hint="One of the 10 codes you saved when you set up two step login. Each works once."
            />
          ) : (
            <TotpField
              value={code}
              onChange={setCode}
              disabled={working}
              hint="The 6 digit code from your authenticator app. Leave it empty only if two step login is not set up yet."
            />
          )}
          <button
            className="btn btn-quiet btn-inline"
            type="button"
            onClick={() => {
              setUseRecoveryCode((current) => !current)
              setCode('')
            }}
            disabled={working}
          >
            {useRecoveryCode ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
          </button>
        </div>
        {error ? (
          <p className="notice notice-error" role="alert">
            {error.kind === 'wrong_credentials'
              ? 'The email, master password, or code was not accepted.'
              : signInErrorText(error)}
          </p>
        ) : null}
        {working ? <div className="progress" aria-hidden="true" /> : null}
        <button className="btn btn-primary" type="submit" disabled={working}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onSetup} disabled={working}>
          Create a new vault
        </button>
        {onRecover ? (
          <button className="btn btn-quiet" type="button" onClick={onRecover} disabled={working}>
            Forgot your master password?
          </button>
        ) : null}
      </form>
    </AuthShell>
  )
}
