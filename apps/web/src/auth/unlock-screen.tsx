import type { Cache, CacheMeta } from '@securepass/shared/cache'
import { type FormEvent, useState } from 'react'
import { PasswordField } from '../ui/text-field'
import { AuthShell } from './auth-shell'
import { type Session, unlockWithPassword } from './vault-session'

type Props = {
  readonly cache: Cache
  readonly meta: CacheMeta
  readonly notice?: string | undefined
  readonly onUnlocked: (session: Session) => void
}

/** Unlock from the local cache. A wrong password gets one plain message and nothing more. */
export function UnlockScreen({ cache, meta, notice, onUnlocked }: Props) {
  const [password, setPassword] = useState('')
  const [working, setWorking] = useState(false)
  const [failed, setFailed] = useState(false)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setFailed(false)
    setWorking(true)
    const result = await unlockWithPassword(cache, meta, password)
    setWorking(false)
    // The password field is cleared as soon as the keys are derived.
    setPassword('')
    if (result.ok) onUnlocked(result.value)
    else setFailed(true)
  }

  return (
    <AuthShell>
      <form className="card" onSubmit={submit} aria-busy={working}>
        <div className="card-head">
          <h1>Unlock your vault</h1>
          <p>{meta.email}</p>
        </div>
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
        <p className="notice">Unlock here only on devices you trust.</p>
        {/* Lets a browser or password manager tie the master password to this account. */}
        <input
          className="visually-hidden"
          type="text"
          name="username"
          autoComplete="username"
          value={meta.email}
          readOnly
          tabIndex={-1}
          aria-hidden="true"
        />
        <PasswordField
          label="Master password"
          value={password}
          onChange={setPassword}
          autoComplete="current-password"
          required
          autoFocus
          disabled={working}
          error={failed ? 'That password did not unlock the vault.' : undefined}
        />
        {working ? <div className="progress" aria-hidden="true" /> : null}
        <button className="btn btn-primary" type="submit" disabled={working || password === ''}>
          {working ? 'Unlocking…' : 'Unlock'}
        </button>
      </form>
    </AuthShell>
  )
}
