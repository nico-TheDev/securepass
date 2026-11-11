import type { Cache } from '@securepass/shared/cache'
import {
  type FinishedRecovery,
  finishRecovery,
  type PendingRecovery,
  startRecovery,
} from '@securepass/vault'
import { type FormEvent, useMemo, useState } from 'react'
import { downloadText } from '../ui/download'
import { signInErrorText } from '../ui/errors'
import { PasswordField, TextArea, TextField } from '../ui/text-field'
import { TotpField } from '../ui/totp-dialog'
import { api } from './api'
import { AuthShell } from './auth-shell'
import { kitConfirmed, RecoveryKitPanel } from './recovery-kit-panel'
import { measureStrength } from './strength'
import { StrengthMeter } from './strength-meter'
import { DEVICE_NAME, type Session } from './vault-session'

type Props = {
  readonly cache: Cache
  readonly email?: string | undefined
  readonly onRecovered: (session: Session) => void
  readonly onCancel: () => void
}

/**
 * Recovery with the kit: prove the recovery key and a second proof, set a new master password,
 * then save the new kit. The old kit stops working the moment the new password is set.
 */
export function RecoverScreen({ cache, email: knownEmail, onRecovered, onCancel }: Props) {
  const [pending, setPending] = useState<PendingRecovery | undefined>()
  const [finished, setFinished] = useState<FinishedRecovery | undefined>()

  return (
    <AuthShell>
      {finished ? (
        <NewKitStep finished={finished} onDone={() => onRecovered(finished.session)} />
      ) : pending ? (
        <NewPasswordStep
          cache={cache}
          pending={pending}
          onFinished={setFinished}
          onCancel={onCancel}
        />
      ) : (
        <ProveStep email={knownEmail ?? ''} onProved={setPending} onCancel={onCancel} />
      )}
    </AuthShell>
  )
}

function ProveStep({
  email: initialEmail,
  onProved,
  onCancel,
}: {
  readonly email: string
  readonly onProved: (pending: PendingRecovery) => void
  readonly onCancel: () => void
}) {
  const [email, setEmail] = useState(initialEmail)
  const [recoveryKey, setRecoveryKey] = useState('')
  const [code, setCode] = useState('')
  const [useRecoveryCode, setUseRecoveryCode] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    setWorking(true)
    const result = await startRecovery(
      api,
      email,
      recoveryKey,
      useRecoveryCode ? { recovery_code: code } : { totp_code: code },
    )
    setWorking(false)
    setCode('')
    if (result.ok) return onProved(result.value)
    setError(
      result.error.kind === 'bad_recovery_key'
        ? 'That is not a complete recovery key. It has 13 groups of 4 letters and digits.'
        : result.error.kind === 'wrong_credentials'
          ? 'The email, recovery key, or code was not accepted.'
          : signInErrorText(result.error),
    )
  }

  return (
    <form className="card" onSubmit={submit} aria-busy={working}>
      <div className="card-head">
        <h1>Recover your vault</h1>
        <p>
          Use the recovery key from your recovery kit, plus a code, to set a new master password.
          Your items stay as they are.
        </p>
      </div>
      <div className="form">
        <TextField
          label="Email"
          type="email"
          value={email}
          onChange={setEmail}
          autoComplete="username"
          required
          disabled={working}
        />
        <TextArea
          label="Recovery key"
          value={recoveryKey}
          onChange={setRecoveryKey}
          hint="From securepass-recovery-kit.txt. Dashes, spaces, and capitals do not matter."
          autoComplete="off"
          required
          disabled={working}
          rows={3}
        />
        {useRecoveryCode ? (
          <TextField
            label="Recovery code"
            value={code}
            onChange={setCode}
            autoComplete="off"
            disabled={working}
            hint="One of the 10 codes from when you set up two step login."
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
          disabled={working}
        >
          {useRecoveryCode ? 'Use an authenticator code instead' : 'Use a recovery code instead'}
        </button>
      </div>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <button className="btn btn-primary" type="submit" disabled={working}>
        {working ? 'Checking…' : 'Continue'}
      </button>
      <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={working}>
        Back
      </button>
    </form>
  )
}

function NewPasswordStep({
  cache,
  pending,
  onFinished,
  onCancel,
}: {
  readonly cache: Cache
  readonly pending: PendingRecovery
  readonly onFinished: (finished: FinishedRecovery) => void
  readonly onCancel: () => void
}) {
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | undefined>()
  const strength = useMemo(
    () => measureStrength(password, pending.email),
    [password, pending.email],
  )
  const mismatch = confirm !== '' && confirm !== password

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (password === '' || password !== confirm) return
    setError(undefined)
    setWorking(true)
    const result = await finishRecovery(api, cache, pending, password, DEVICE_NAME)
    setWorking(false)
    setPassword('')
    setConfirm('')
    if (result.ok) return onFinished(result.value)
    setError(
      result.error.kind === 'wrong_credentials'
        ? 'The recovery step expired (it lasts 10 minutes). Go back and start again.'
        : signInErrorText(result.error),
    )
  }

  return (
    <form className="card" onSubmit={submit} aria-busy={working}>
      <div className="card-head">
        <h1>Set a new master password</h1>
        <p>
          The recovery key was accepted for {pending.email}. Every device will be signed out and you
          will get a new recovery kit next.
        </p>
      </div>
      <div className="form">
        <PasswordField
          label="New master password"
          value={password}
          onChange={setPassword}
          autoComplete="new-password"
          required
          autoFocus
          disabled={working}
        >
          <StrengthMeter strength={strength} empty={password === ''} />
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
      </div>
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      {working ? <div className="progress" aria-hidden="true" /> : null}
      <button
        className="btn btn-primary"
        type="submit"
        disabled={working || mismatch || password === ''}
      >
        {working ? 'Saving…' : 'Set new master password'}
      </button>
      <button className="btn btn-quiet" type="button" onClick={onCancel} disabled={working}>
        Cancel
      </button>
    </form>
  )
}

function NewKitStep({
  finished,
  onDone,
}: {
  readonly finished: FinishedRecovery
  readonly onDone: () => void
}) {
  const [typed, setTyped] = useState('')
  const codesText = ['securepass recovery codes', '', ...finished.recoveryCodes, ''].join('\n')

  return (
    <form
      className="card"
      onSubmit={(event) => {
        event.preventDefault()
        if (kitConfirmed(finished.kit, typed)) onDone()
      }}
    >
      <div className="card-head">
        <h1>Save your new recovery kit</h1>
        <p>
          Your new master password is set. The old recovery kit and the old recovery codes no longer
          work, so save these new ones now.
        </p>
      </div>
      <RecoveryKitPanel
        kit={finished.kit}
        email={finished.session.meta.email}
        typed={typed}
        onTyped={setTyped}
        disabled={false}
      />
      {finished.recoveryCodes.length > 0 ? (
        <div className="form">
          <p>
            <strong>New recovery codes.</strong> Each works once in place of an authenticator code.
          </p>
          <ul className="code-list" aria-label="New recovery codes">
            {finished.recoveryCodes.map((code) => (
              <li key={code}>{code}</li>
            ))}
          </ul>
          <div className="kit-actions">
            <button
              className="btn"
              type="button"
              onClick={() => downloadText('securepass-recovery-codes.txt', codesText)}
            >
              Download the codes
            </button>
          </div>
        </div>
      ) : null}
      <button
        className="btn btn-primary"
        type="submit"
        disabled={!kitConfirmed(finished.kit, typed)}
      >
        Open my vault
      </button>
    </form>
  )
}
