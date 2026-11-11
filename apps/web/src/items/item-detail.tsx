import { checkBreach, IDENTITY_KEYS, type OpenVaultItem } from '@securepass/vault'
import { useState } from 'react'
import { SecretRow } from './secret-row'

const THIRTY_DAYS_SECONDS = 30 * 24 * 60 * 60

const IDENTITY_LABELS: Record<(typeof IDENTITY_KEYS)[number], string> = {
  title: 'Title',
  first: 'First name',
  last: 'Last name',
  email: 'Email',
  phone: 'Phone',
  address1: 'Address line 1',
  address2: 'Address line 2',
  city: 'City',
  region: 'State or region',
  postal: 'Postal code',
  country: 'Country',
}

const dateText = (iso: string): string =>
  new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

type Props = {
  readonly item: OpenVaultItem
  readonly onBack: () => void
  readonly onEdit: () => void
  readonly onToggleFavorite: () => void
  readonly onTrash: () => void
  readonly onRestore: () => void
  readonly onDeleteForever: () => void
  readonly onDiscardCopies: () => void
  readonly onDismissRollback: () => void
}

/** One item, opened: its fields with copy buttons, its password history, and its kept copies. */
export function ItemDetail(props: Props) {
  const { item } = props
  const { payload } = item
  const [breach, setBreach] = useState<string | null>(null)
  const [checking, setChecking] = useState(false)
  const copies = payload.conflict_copies ?? []
  const history = payload.password_history ?? []

  const runBreachCheck = async () => {
    setChecking(true)
    setBreach(null)
    const result = await checkBreach(payload.login?.password ?? '')
    setChecking(false)
    setBreach(
      !result.ok
        ? 'The breach check could not be reached. Try again later.'
        : result.value === 0
          ? 'This password was not found in any known breach.'
          : `This password appears ${result.value.toLocaleString()} times in known breaches. Change it.`,
    )
  }

  const purgeDate =
    payload.trashed && item.deletedAt !== null
      ? new Date((item.deletedAt + THIRTY_DAYS_SECONDS) * 1000).toLocaleDateString([], {
          dateStyle: 'medium',
        })
      : null

  return (
    <article className="detail" aria-labelledby="detail-title">
      <button className="btn btn-quiet btn-inline detail-back" type="button" onClick={props.onBack}>
        ← Back to the list
      </button>
      <header className="detail-head">
        <div>
          <h2 id="detail-title">{payload.name}</h2>
          <p className="item-sub">
            {payload.folder ? `${payload.folder} · ` : ''}
            Edited {dateText(payload.edited_at)}
            {item.pending ? ' · Not synced yet' : ''}
          </p>
        </div>
        <div className="detail-head-actions">
          {payload.trashed ? (
            <>
              <button className="btn" type="button" onClick={props.onRestore}>
                Restore
              </button>
              <button className="btn btn-danger" type="button" onClick={props.onDeleteForever}>
                Delete forever
              </button>
            </>
          ) : (
            <>
              <button className="btn btn-primary" type="button" onClick={props.onEdit}>
                Edit
              </button>
              <button
                className="btn"
                type="button"
                aria-pressed={payload.favorite}
                onClick={props.onToggleFavorite}
              >
                {payload.favorite ? 'Remove from favorites' : 'Add to favorites'}
              </button>
              <button className="btn" type="button" onClick={props.onTrash}>
                Move to trash
              </button>
            </>
          )}
        </div>
      </header>

      {payload.trashed ? (
        <p className="notice">
          This item is in the trash.{' '}
          {purgeDate
            ? `It will be removed for good from every device on ${purgeDate}.`
            : 'It will be removed for good from every device 30 days after it reaches the server.'}
        </p>
      ) : null}
      {item.rolledBack ? (
        <div className="notice notice-error" role="alert">
          <p>
            The server sent an older version of this item than this device had already seen. The
            older version was not applied, and what you see here is your newer copy.
          </p>
          <button className="btn btn-small" type="button" onClick={props.onDismissRollback}>
            I understand
          </button>
        </div>
      ) : null}

      <dl className="detail-fields">
        {payload.type === 'login' ? (
          <>
            <SecretRow label="Username" value={payload.login?.username ?? ''} />
            <SecretRow label="Password" value={payload.login?.password ?? ''} secret />
            {(payload.login?.urls ?? []).map((entry) => (
              <SecretRow
                key={`${entry.url}|${entry.match}`}
                label={entry.match === 'host' ? 'Website (exact host)' : 'Website'}
                value={entry.url}
              />
            ))}
            <SecretRow label="Authenticator key" value={payload.login?.totp_secret ?? ''} secret />
          </>
        ) : null}
        {payload.type === 'identity'
          ? IDENTITY_KEYS.map((key) => (
              <SecretRow
                key={key}
                label={IDENTITY_LABELS[key]}
                value={payload.identity?.[key] ?? ''}
              />
            ))
          : null}
        <SecretRow label="Note" value={payload.note} multiline secret={payload.type === 'note'} />
      </dl>

      {payload.type === 'login' && (payload.login?.password ?? '') !== '' ? (
        <div className="detail-section">
          <button
            className="btn"
            type="button"
            onClick={() => void runBreachCheck()}
            disabled={checking}
          >
            {checking ? 'Checking…' : 'Check this password for breaches'}
          </button>
          <p className="field-hint">
            Only the first 5 characters of a hash of the password are sent, never the password.
          </p>
          <p role="status">{breach ?? ''}</p>
        </div>
      ) : null}

      {history.length > 0 ? (
        <section className="detail-section" aria-labelledby="history-title">
          <h3 id="history-title">Previous passwords</h3>
          <dl className="detail-fields">
            {history.map((entry) => (
              <SecretRow
                key={`${entry.replaced_at}|${entry.password}`}
                label={`Replaced ${dateText(entry.replaced_at)}`}
                value={entry.password}
                secret
              />
            ))}
          </dl>
        </section>
      ) : null}

      {copies.length > 0 ? (
        <section className="detail-section" aria-labelledby="copies-title">
          <h3 id="copies-title">Kept versions from sync conflicts</h3>
          <p className="notice">
            This item was changed on two devices before they synced. The newer change won, and{' '}
            {copies.length === 1
              ? 'the other version is'
              : `the other ${copies.length} versions are`}{' '}
            kept here so nothing is lost.
          </p>
          {copies.map((copy) => (
            <details
              key={`${copy.kept_at}|${copy.payload.edited_at}|${copy.payload.edited_by}`}
              className="copy"
            >
              <summary>
                {copy.payload.name}, edited {dateText(copy.payload.edited_at)}
              </summary>
              <dl className="detail-fields">
                <SecretRow label="Username" value={copy.payload.login?.username ?? ''} />
                <SecretRow label="Password" value={copy.payload.login?.password ?? ''} secret />
                {(copy.payload.login?.urls ?? []).map((entry) => (
                  <SecretRow key={entry.url} label="Website" value={entry.url} />
                ))}
                {IDENTITY_KEYS.map((key) => (
                  <SecretRow
                    key={key}
                    label={IDENTITY_LABELS[key]}
                    value={copy.payload.identity?.[key] ?? ''}
                  />
                ))}
                <SecretRow label="Note" value={copy.payload.note} multiline secret />
              </dl>
            </details>
          ))}
          <button className="btn" type="button" onClick={props.onDiscardCopies}>
            I have what I need, remove the kept versions
          </button>
        </section>
      ) : null}
    </article>
  )
}
