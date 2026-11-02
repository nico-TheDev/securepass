import type { Cache } from '@securepass/shared/cache'
import { type FormEvent, useState } from 'react'
import { PasswordField, TextField } from '../ui/text-field'
import { AuthShell } from './auth-shell'
import { type Session, type SignInError, signIn } from './vault-session'

type Props = {
  readonly cache: Cache
  readonly onSignedIn: (session: Session) => void
  readonly onSetup: () => void
}

const signInErrorText = (error: SignInError): string => {
  switch (error.kind) {
    case 'wrong_credentials':
      return 'The email or master password was not accepted.'
    case 'network':
      return 'Could not reach the server. Check your connection and try again.'
    case 'crypto':
      return 'The server sent settings this app will not accept, so nothing was unlocked.'
    case 'server':
      return 'The server could not sign you in. Try again in a moment.'
  }
}

/** For a device with no local copy yet: ask the server for the KDF settings, then derive and prove here. */
export function SignInScreen({ cache, onSignedIn, onSetup }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<SignInError | undefined>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    setWorking(true)
    const result = await signIn(cache, email, password)
    setWorking(false)
    setPassword('')
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
        </div>
        {error ? (
          <p className="notice notice-error" role="alert">
            {signInErrorText(error)}
          </p>
        ) : null}
        {working ? <div className="progress" aria-hidden="true" /> : null}
        <button className="btn btn-primary" type="submit" disabled={working}>
          {working ? 'Signing in…' : 'Sign in'}
        </button>
        <button className="btn btn-quiet" type="button" onClick={onSetup} disabled={working}>
          Create a new vault
        </button>
      </form>
    </AuthShell>
  )
}
