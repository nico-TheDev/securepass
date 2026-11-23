import type { Cache } from '@securepass/shared/cache'
import { type Session, type SignInError, signIn } from '@securepass/vault'
import { type FormEvent, useState } from 'react'
import { env } from '../env'
import { DEVICE_NAME, readDeviceId } from '../local-store'
import { api, signInErrorText } from './background'
import { PasswordField, TextField } from './fields'

type Props = {
  readonly cache: Cache
  readonly notice?: string | undefined
  readonly onSignedIn: (session: Session) => void
}

/** For an extension with no copy of the vault yet: sign in as this extension's own device. */
export function SignIn({ cache, notice, onSignedIn }: Props) {
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
    const result = await signIn(api, cache, {
      email,
      password,
      second: useRecoveryCode ? { recovery_code: code } : { totp_code: code },
      deviceName: DEVICE_NAME,
      deviceId: await readDeviceId(),
    })
    setWorking(false)
    setPassword('')
    setCode('')
    if (result.ok) onSignedIn(result.value)
    else setError(result.error)
  }

  return (
    <main className="screen">
      <h1>Sign in to your vault</h1>
      <p className="muted">
        This extension keeps its own encrypted copy of your vault from {new URL(env.serverUrl).host}
        . Your master password never leaves this device.
      </p>
      {notice ? <p className="notice">{notice}</p> : null}
      <form className="form" onSubmit={submit} aria-busy={working}>
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
        <TextField
          label={useRecoveryCode ? 'Recovery code' : 'Authenticator code'}
          value={code}
          onChange={setCode}
          autoComplete={useRecoveryCode ? 'off' : 'one-time-code'}
          inputMode={useRecoveryCode ? 'text' : 'numeric'}
          disabled={working}
          hint={
            useRecoveryCode
              ? 'One of the 10 codes you saved when you set up two step login. Each works once.'
              : 'The 6 digit code from your authenticator app.'
          }
        />
        <button
          className="btn btn-quiet"
          type="button"
          disabled={working}
          onClick={() => {
            setUseRecoveryCode((current) => !current)
            setCode('')
          }}
        >
          {useRecoveryCode ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
        </button>
        {error ? (
          <p className="notice notice-error" role="alert">
            {signInErrorText(error)}
          </p>
        ) : null}
        {working ? <div className="progress" aria-hidden="true" /> : null}
        <button className="btn btn-primary" type="submit" disabled={working}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
      <p className="muted">
        No vault yet? Create it in the{' '}
        <a href={env.serverUrl} target="_blank" rel="noreferrer">
          web vault
        </a>{' '}
        first.
      </p>
    </main>
  )
}
