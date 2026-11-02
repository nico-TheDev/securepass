import { type ReactNode, useId, useState } from 'react'

type CommonProps = {
  readonly label: string
  readonly value: string
  readonly onChange: (value: string) => void
  readonly hint?: ReactNode
  readonly error?: string | undefined
  readonly autoComplete?: string
  readonly required?: boolean
  readonly autoFocus?: boolean
  readonly disabled?: boolean
}

const describedBy = (id: string, hint: ReactNode, error: string | undefined) =>
  [hint ? `${id}-hint` : null, error ? `${id}-error` : null].filter(Boolean).join(' ') || undefined

/** A labelled text input with an optional hint and error. */
export function TextField(props: CommonProps & { readonly type?: 'text' | 'email' | 'url' }) {
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
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={`${id}-error`} className="field-error">
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** A labelled password input with a Show/Hide button. The value is hidden until you choose to show it. */
export function PasswordField(props: CommonProps & { readonly children?: ReactNode }) {
  const id = useId()
  const [shown, setShown] = useState(false)
  const { label, value, onChange, hint, error, children, ...rest } = props
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
      {children}
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
    </div>
  )
}

/** A labelled multi line input. */
export function TextArea(props: CommonProps) {
  const id = useId()
  const { label, value, onChange, hint, error, ...rest } = props
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <textarea
        id={id}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-describedby={describedBy(id, hint, error)}
        {...rest}
      />
      {hint ? (
        <p id={`${id}-hint`} className="field-hint">
          {hint}
        </p>
      ) : null}
    </div>
  )
}
