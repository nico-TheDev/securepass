import type { TotpEnrollResponse } from '@securepass/shared'
import { type Cache, readMeta, writeMeta } from '@securepass/shared/cache'
import { type FormEvent, useCallback, useEffect, useState } from 'react'
import { copySecret } from '../ui/clipboard'
import { downloadText } from '../ui/download'
import { TotpField } from '../ui/totp-dialog'
import { api } from './api'
import { AuthShell } from './auth-shell'
import { QrCode } from './qr-code'
import type { Session } from './vault-session'

type Props = {
  readonly cache: Cache
  readonly session: Session
  /** Called once two step login is known to be on, or the user goes on offline. */
  readonly onDone: (session: Session) => void
}

type State =
  | { readonly step: 'loading' }
  | { readonly step: 'offline' }
  | { readonly step: 'scan'; readonly enrollment: TotpEnrollResponse }

/** Marks this device as knowing that two step login is on. */
const markEnrolled = async (cache: Cache, session: Session): Promise<Session> => {
  const meta = { ...((await readMeta(cache)) ?? session.meta), totp_enrolled: true }
  await writeMeta(cache, meta)
  return { ...session, meta }
}

const secretOf = (otpauthUri: string): string =>
  (new URL(otpauthUri).searchParams.get('secret') ?? '').replaceAll(/(.{4})/g, '$1 ').trim()

/**
 * Forced right after setup: scan the QR code, save the recovery codes, and prove one code.
 * Until this is confirmed the server lets a login through with the password alone.
 */
export function TotpEnrollScreen({ cache, session, onDone }: Props) {
  const [state, setState] = useState<State>({ step: 'loading' })
  const [code, setCode] = useState('')
  const [saved, setSaved] = useState(false)
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | undefined>()

  const start = useCallback(async () => {
    setState({ step: 'loading' })
    const token = (await readMeta(cache))?.token ?? session.meta.token
    const reply = await api.totpEnroll(token)
    if (reply.ok) return setState({ step: 'scan', enrollment: reply.value })
    // 409: it is already on, set up from this or another device.
    if (reply.error.kind === 'status' && reply.error.status === 409) {
      return onDone(await markEnrolled(cache, session))
    }
    setState({ step: 'offline' })
  }, [cache, session, onDone])

  useEffect(() => {
    void start()
  }, [start])

  if (state.step === 'loading') {
    return (
      <AuthShell>
        <div className="card" role="status">
          Checking two step login…
        </div>
      </AuthShell>
    )
  }

  if (state.step === 'offline') {
    return (
      <AuthShell>
        <div className="card">
          <div className="card-head">
            <h1>Set up two step login</h1>
            <p>
              The server could not be reached, so two step login cannot be set up right now. You can
              open your vault from this device and you will be asked again next time.
            </p>
          </div>
          <button className="btn btn-primary" type="button" onClick={() => void start()}>
            Try again
          </button>
          <button className="btn btn-quiet" type="button" onClick={() => onDone(session)}>
            Open the vault for now
          </button>
        </div>
      </AuthShell>
    )
  }

  const { otpauth_uri, recovery_codes } = state.enrollment
  const codesText = [
    'securepass recovery codes',
    '',
    'Each code works once, in place of an authenticator code.',
    '',
    ...recovery_codes,
    '',
  ].join('\n')

  const confirm = async (event: FormEvent) => {
    event.preventDefault()
    setError(undefined)
    setWorking(true)
    const token = (await readMeta(cache))?.token ?? session.meta.token
    const reply = await api.totpConfirm(token, code.replaceAll(/\s/g, ''))
    setWorking(false)
    if (reply.ok) return onDone(await markEnrolled(cache, session))
    setCode('')
    setError(
      reply.error.kind === 'network'
        ? 'Could not reach the server. Check your connection and try again.'
        : 'That code was not accepted. Wait for the next code and try again.',
    )
  }

  return (
    <AuthShell>
      <form className="card" onSubmit={confirm} aria-busy={working}>
        <div className="card-head">
          <h1>Set up two step login</h1>
          <p>
            From now on, signing in on a new device needs your master password and a code from an
            authenticator app. This step cannot be skipped.
          </p>
        </div>
        <div className="enroll-scan">
          <QrCode text={otpauth_uri} label="QR code for your authenticator app" />
          <div className="form">
            <p>
              <strong>1. Scan this code</strong> with an authenticator app. If you cannot scan it,
              type this key into the app instead:
            </p>
            <p className="secret-text">{secretOf(otpauth_uri)}</p>
          </div>
        </div>
        <div className="form">
          <p>
            <strong>2. Save these recovery codes.</strong> Each one works once if you lose your
            authenticator. They are shown only now.
          </p>
          <ul className="code-list" aria-label="Recovery codes">
            {recovery_codes.map((entry) => (
              <li key={entry}>{entry}</li>
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
            <button
              className="btn"
              type="button"
              onClick={() => void copySecret(recovery_codes.join('\n'))}
            >
              Copy the codes
            </button>
          </div>
          <label className="check">
            <input
              type="checkbox"
              checked={saved}
              onChange={(event) => setSaved(event.target.checked)}
            />
            I saved the recovery codes somewhere safe
          </label>
        </div>
        <TotpField
          label="3. Type the code your app shows"
          value={code}
          onChange={setCode}
          disabled={working}
        />
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        <button
          className="btn btn-primary"
          type="submit"
          disabled={working || !saved || code.trim() === ''}
        >
          {working ? 'Checking…' : 'Turn on two step login'}
        </button>
      </form>
    </AuthShell>
  )
}
