import { type ReactNode, useId, useState } from 'react'

type Props = {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly hint?: ReactNode
  readonly error?: string | undefined
  readonly autoComplete?: string
  readonly required?: boolean
  readonly autoFocus?: boolean
  readonly disabled?: boolean
  readonly inputMode?: 'text' | 'numeric'
}

const describedBy = (id: string, hint: ReactNode, error: string | undefined) =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined

const Notes = ({ id, hint, error }: { id: string; hint: ReactNode; error: string | undefined }) => (
  <>
    {hint ? (
      <p id={`${id}-hint`} className="field-hint">
        {hint}
      </p>
    ) : null}
    {error ? (
      <p id={`${id}-error`} className="field-error" role="alert">
        {error}
      </p>
    ) : null}
  </>
)

/** A labelled text input with an optional hint and error. */
export function TextField(props: Props & { readonly type?: 'text' | 'email' | 'search' }) {
  const id = useId()
  const { label, value, onChange, hint, error, type = 'text', ...rest } = props
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy(id, hint, error)}
        spellCheck={false}
        {...rest}
      />
      <Notes id={id} hint={hint} error={error} />
    </div>
  )
}

/** A labelled secret input with a Show/Hide button. The value is hidden until you choose to show it. */
export function PasswordField(props: Props) {
  const id = useId()
  const [shown, setShown] = useState(false)
  const { label, value, onChange, hint, error, ...rest } = props
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className="password-row">
        <input
          id={id}
          type={shown ? 'text' : 'password'}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          aria-invalid={error ? true : undefined}
          aria-describedby={describedBy(id, hint, error)}
          spellCheck={false}
          autoCapitalize="off"
          {...rest}
        />
        <button
          type="button"
          className="btn"
          aria-pressed={shown}
          onClick={() => setShown((current) => !current)}
        >
          {shown ? 'Hide' : 'Show'}
          <span className="visually-hidden"> {label.toLowerCase()}</span>
        </button>
      </div>
      <Notes id={id} hint={hint} error={error} />
    </div>
  )
}
