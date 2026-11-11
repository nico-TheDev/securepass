import { useEffect, useState } from 'react'
import { copySecret } from '../ui/clipboard'

type Props = {
  readonly label: string
  readonly value: string
  /** Secrets are hidden until shown, and cleared from the clipboard after 30 seconds. */
  readonly secret?: boolean
  readonly multiline?: boolean
}

/** One labelled value of an item with a Copy button, and a Show button when it is a secret. */
export function SecretRow({ label, value, secret = false, multiline = false }: Props) {
  const [shown, setShown] = useState(!secret)
  const [copied, setCopied] = useState<'yes' | 'failed' | null>(null)

  useEffect(() => {
    if (copied === null) return
    const timer = setTimeout(() => setCopied(null), 2500)
    return () => clearTimeout(timer)
  }, [copied])

  const copy = async () => {
    const done = secret
      ? await copySecret(value)
      : await navigator.clipboard.writeText(value).then(
          () => true,
          () => false,
        )
    setCopied(done ? 'yes' : 'failed')
  }

  if (value === '') return null
  return (
    <div className="detail-row">
      <dt>{label}</dt>
      <dd>
        <span className={multiline ? 'detail-value detail-multiline' : 'detail-value'}>
          {shown ? value : '••••••••••••'}
        </span>
        <span className="detail-actions">
          {secret ? (
            <button
              className="btn btn-small"
              type="button"
              aria-pressed={shown}
              onClick={() => setShown((current) => !current)}
            >
              {shown ? 'Hide' : 'Show'}
              <span className="visually-hidden"> {label.toLowerCase()}</span>
            </button>
          ) : null}
          <button className="btn btn-small" type="button" onClick={() => void copy()}>
            Copy<span className="visually-hidden"> {label.toLowerCase()}</span>
          </button>
        </span>
        <span className="detail-status" role="status">
          {copied === 'yes'
            ? secret
              ? 'Copied. It will be cleared from the clipboard in 30 seconds if this tab stays open.'
              : 'Copied.'
            : copied === 'failed'
              ? 'The browser did not allow the copy.'
              : ''}
        </span>
      </dd>
    </div>
  )
}
