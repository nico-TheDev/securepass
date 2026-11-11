import { type FormEvent, useState } from 'react'
import { Dialog } from './dialog'
import { TextField } from './text-field'

type Props = {
  readonly open: boolean
  readonly title: string
  readonly description: string
  readonly confirmLabel: string
  /** Runs the action with the typed code. Returns an error message, or `null` when it worked. */
  readonly onConfirm: (totpCode: string) => Promise<string | null>
  readonly onClose: () => void
}

/** Asks for a fresh authenticator code before a sensitive action, and shows why if it fails. */
export function TotpDialog(props: Props) {
  return (
    <Dialog open={props.open} title={props.title} onClose={props.onClose}>
      <TotpForm {...props} />
    </Dialog>
  )
}

function TotpForm({ description, confirmLabel, onConfirm, onClose }: Props) {
  const [code, setCode] = useState('')
  const [working, setWorking] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setWorking(true)
    setError(null)
    const failure = await onConfirm(code.replaceAll(/\s/g, ''))
    setWorking(false)
    if (failure === null) onClose()
    else {
      setError(failure)
      setCode('')
    }
  }

  return (
    <form className="form" onSubmit={submit}>
      <p>{description}</p>
      <TotpField value={code} onChange={setCode} autoFocus disabled={working} />
      {error ? (
        <p className="notice notice-error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button className="btn" type="button" onClick={onClose} disabled={working}>
          Cancel
        </button>
        <button className="btn btn-danger" type="submit" disabled={working || code.trim() === ''}>
          {working ? 'Working…' : confirmLabel}
        </button>
      </div>
    </form>
  )
}

/** The 6 digit authenticator code input used across the app. */
export function TotpField({
  value,
  onChange,
  autoFocus,
  disabled,
  label = 'Authenticator code',
  hint = 'The 6 digit code from your authenticator app. Each code works once.',
}: {
  readonly value: string
  readonly onChange: (value: string) => void
  readonly autoFocus?: boolean
  readonly disabled?: boolean
  readonly label?: string
  readonly hint?: string
}) {
  return (
    <TextField
      label={label}
      value={value}
      onChange={onChange}
      hint={hint}
      autoComplete="one-time-code"
      inputMode="numeric"
      {...(autoFocus ? { autoFocus } : {})}
      {...(disabled ? { disabled } : {})}
    />
  )
}
