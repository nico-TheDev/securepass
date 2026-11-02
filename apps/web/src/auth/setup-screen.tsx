import type { Cache } from '@securepass/shared/cache'
import { type FormEvent, useId, useMemo, useState } from 'react'
import { env } from '../env'
import { PasswordField, TextField } from '../ui/text-field'
import { AuthShell } from './auth-shell'
import { RECOVERY_KIT_FILE_NAME, recoveryKitText } from './recovery-kit-file'
import { measureStrength } from './strength'
import { StrengthMeter } from './strength-meter'
import {
  completeSetup,
  type PendingSetup,
  prepareSetup,
  type Session,
  type SetupError,
} from './vault-session'

type Props = {
  readonly cache: Cache
  readonly notice?: string | undefined
  readonly onDone: (session: Session) => void
  readonly onSignIn: () => void
}

const setupErrorText = (error: SetupError): string => {
  switch (error.kind) {
    case 'bad_token':
      return 'The setup token was not accepted. Check it against the SETUP_TOKEN you set on the server.'
    case 'account_exists':
      return 'An account already exists on this server. Sign in instead.'
    case 'network':
      return 'Could not reach the server. Check your connection and try again.'
    case 'crypto':
      return 'Could not create the keys on this device. Reload the page and try again.'
    case 'server':
      return 'The server could not finish setup. Try again in a moment.'
  }
}

/** Step 1 is the account form. Step 2 is the recovery kit, which must be confirmed before the server is called. */
export function SetupScreen({ cache, notice, onDone, onSignIn }: Props) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [setupToken, setSetupToken] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const [pending, setPending] = useState<PendingSetup | undefined>()

  const strength = useMemo(() => measureStrength(password, email), [password, email])
  const mismatch = confirm !== '' && confirm !== password

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password !== confirm) return
    setError(undefined)
    setWorking(true)
    const prepared = await prepareSetup(email, password)
    setWorking(false)
    if (!prepared.ok) return setError(setupErrorText(prepared.error))
    // The master password is no longer needed once the keys exist.
    setPassword('')
    setConfirm('')
    setPending(prepared.value)
  }

  if (pending) {
    return (
      <AuthShell>
        <RecoveryKitStep
          cache={cache}
          pending={pending}
          setupToken={setupToken}
          onDone={onDone}
          onSignIn={onSignIn}
        />
      </AuthShell>
    )
  }

  return (
    <AuthShell>
      <form className="card" onSubmit={submit} aria-busy={working}>
        <div className="card-head">
          <h1>Create your vault</h1>
          <p>One account, made on this device. You will save a recovery kit next.</p>
        </div>
        {notice ? (
          <p className="notice" role="status">
            {notice}
          </p>
        ) : null}
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
            autoComplete="new-password"
            required
            disabled={working}
            hint="Pick something long that you have never used anywhere else. We cannot reset it."
          >
            <StrengthMeter strength={strength} empty={password === ''} />
          </PasswordField>
          <PasswordField
            label="Confirm master password"
            value={confirm}
            onChange={setConfirm}
            autoComplete="new-password"
            required
            disabled={working}
            error={mismatch ? 'The two passwords do not match.' : undefined}
          />
          <PasswordField
            label="Setup token"
            value={setupToken}
            onChange={setSetupToken}
            autoComplete="off"
            required
            disabled={working}
            hint="The one time SETUP_TOKEN you set on your server."
          />
        </div>
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        {working ? (
          <>
            <div className="progress" aria-hidden="true" />
            <p className="field-hint" role="status">
              Making your keys on this device. This takes a moment.
            </p>
          </>
        ) : null}
        <button className="btn btn-primary" type="submit" disabled={working || mismatch}>
          Continue
        </button>
        <button className="btn btn-quiet" type="button" onClick={onSignIn} disabled={working}>
          I already have an account
        </button>
      </form>
    </AuthShell>
  )
}

function RecoveryKitStep({
  cache,
  pending,
  setupToken,
  onDone,
  onSignIn,
}: {
  readonly cache: Cache
  readonly pending: PendingSetup
  readonly setupToken: string
  readonly onDone: (session: Session) => void
  readonly onSignIn: () => void
}) {
  const confirmId = useId()
  const [typed, setTyped] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<SetupError | undefined>()
  const lastGroup = pending.kit.groups.at(-1) ?? ''
  const confirmed = typed.trim().toUpperCase() === lastGroup

  const download = () => {
    const text = recoveryKitText(
      pending.kit,
      pending.request.email,
      env.VITE_API_URL || window.location.origin,
      new Date(),
    )
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    const link = document.createElement('a')
    link.href = url
    link.download = RECOVERY_KIT_FILE_NAME
    link.click()
    URL.revokeObjectURL(url)
  }

  const finish = async (event: FormEvent) => {
    event.preventDefault()
    if (!confirmed) return
    setError(undefined)
    setSaving(true)
    const result = await completeSetup(cache, pending, setupToken)
    setSaving(false)
    if (result.ok) onDone(result.value)
    else setError(result.error)
  }

  return (
    <form className="card" onSubmit={finish} aria-busy={saving}>
      <div className="card-head">
        <h1>Save your recovery kit</h1>
        <p>
          If you forget your master password, this key is the only way back in. We cannot recover it
          for you. Keep it offline.
        </p>
      </div>
      <ol className="kit-key" aria-label="Recovery key, in groups of four characters">
        {pending.kit.groups.map((group, index) => (
          // The groups never change or reorder, so the index is a stable key.
          // biome-ignore lint/suspicious/noArrayIndexKey: fixed list
          <li key={index}>{group}</li>
        ))}
      </ol>
      <div className="kit-actions">
        <button className="btn" type="button" onClick={download}>
          Download {RECOVERY_KIT_FILE_NAME}
        </button>
      </div>
      <div className="field">
        <label htmlFor={confirmId}>Type the last group to confirm you saved it</label>
        <input
          id={confirmId}
          value={typed}
          onChange={(event) => setTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          disabled={saving}
          aria-describedby={`${confirmId}-hint`}
        />
        <p id={`${confirmId}-hint`} className="field-hint">
          The last group is the final four characters of the key above.
        </p>
      </div>
      {error ? (
        <p className="notice notice-error" role="alert">
          {setupErrorText(error)}{' '}
          {error.kind === 'account_exists' ? (
            <button className="btn btn-quiet" type="button" onClick={onSignIn}>
              Sign in
            </button>
          ) : null}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={!confirmed || saving}>
        {saving ? 'Creating your vault…' : 'Finish setup'}
      </button>
    </form>
  )
}
