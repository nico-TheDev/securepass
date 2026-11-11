import type { ItemPayload } from '@securepass/shared'
import {
  DEFAULT_PASSWORD_OPTIONS,
  draftOf,
  emptyDraft,
  generatePassword,
  IDENTITY_KEYS,
  type ItemDraft,
  type SaveError,
  type UrlMatchMode,
} from '@securepass/vault'
import { type FormEvent, useId, useState } from 'react'
import { Dialog } from '../ui/dialog'
import { saveErrorText } from '../ui/errors'
import { PasswordField, TextArea, TextField } from '../ui/text-field'

/** What the form is for: a new item of a type, or an edit of an existing payload. */
export type ItemFormTarget =
  | { readonly kind: 'new'; readonly type: ItemPayload['type'] }
  | { readonly kind: 'edit'; readonly id: string; readonly payload: ItemPayload }

type Props = {
  readonly target: ItemFormTarget | undefined
  readonly folders: readonly string[]
  readonly onClose: () => void
  /** Saves the draft. Returns the reason it failed, or `null` when it was saved. */
  readonly onSave: (target: ItemFormTarget, draft: ItemDraft) => Promise<SaveError | null>
}

const TYPE_NOUN = { login: 'login', note: 'note', identity: 'identity' } as const

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

/** The create and edit form for logins, notes, and identities. */
export function ItemFormDialog({ target, folders, onClose, onSave }: Props) {
  const type = target?.kind === 'edit' ? target.payload.type : (target?.type ?? 'login')
  const title = target?.kind === 'edit' ? `Edit ${TYPE_NOUN[type]}` : `New ${TYPE_NOUN[type]}`
  return (
    <Dialog open={target !== undefined} title={title} onClose={onClose} wide>
      {target ? (
        <ItemForm target={target} folders={folders} onClose={onClose} onSave={onSave} />
      ) : null}
    </Dialog>
  )
}

function ItemForm({
  target,
  folders,
  onClose,
  onSave,
}: Omit<Props, 'target'> & { readonly target: ItemFormTarget }) {
  const [draft, setDraft] = useState<ItemDraft>(() =>
    target.kind === 'edit' ? draftOf(target.payload) : emptyDraft(target.type),
  )
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<SaveError | null>(null)
  const folderListId = useId()

  const set =
    <K extends keyof ItemDraft>(key: K) =>
    (value: ItemDraft[K]) =>
      setDraft((current) => ({ ...current, [key]: value }))

  const setUrl = (index: number, patch: { url?: string; match?: UrlMatchMode }) =>
    setDraft((current) => ({
      ...current,
      urls: current.urls.map((entry, at) => (at === index ? { ...entry, ...patch } : entry)),
    }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setError(null)
    const failure = await onSave(target, draft)
    setSaving(false)
    if (failure === null) onClose()
    else setError(failure)
  }

  const generate = () => {
    const made = generatePassword(DEFAULT_PASSWORD_OPTIONS)
    if (made.ok) set('password')(made.value)
  }

  // A login form always shows at least one website row.
  const urls = draft.urls.length > 0 ? draft.urls : [{ url: '', match: 'domain' as const }]

  return (
    <form className="form" onSubmit={submit}>
      <TextField label="Name" value={draft.name} onChange={set('name')} required autoFocus />
      {draft.type === 'login' ? (
        <>
          <TextField
            label="Username"
            value={draft.username}
            onChange={set('username')}
            autoComplete="off"
          />
          <PasswordField
            label="Password"
            value={draft.password}
            onChange={set('password')}
            autoComplete="off"
          >
            <button className="btn btn-quiet btn-inline" type="button" onClick={generate}>
              Generate a strong password
            </button>
          </PasswordField>
          <fieldset className="group">
            <legend>Websites</legend>
            {urls.map((entry, index) => (
              // Rows are edited in place and only added or removed at the end or by index.
              // biome-ignore lint/suspicious/noArrayIndexKey: position is the identity here
              <div className="url-row" key={index}>
                <TextField
                  label={`Website ${index + 1}`}
                  value={entry.url}
                  onChange={(url) =>
                    setDraft((current) => ({
                      ...current,
                      urls: urls.map((row, at) => (at === index ? { ...row, url } : row)),
                    }))
                  }
                  placeholder="https://example.com"
                  autoComplete="off"
                />
                <div className="field">
                  <label htmlFor={`${folderListId}-match-${index}`}>Fill on</label>
                  <select
                    id={`${folderListId}-match-${index}`}
                    value={entry.match}
                    onChange={(event) => {
                      const match = event.target.value === 'host' ? 'host' : 'domain'
                      if (draft.urls.length === 0) set('urls')([{ url: entry.url, match }])
                      else setUrl(index, { match })
                    }}
                  >
                    <option value="domain">The whole site</option>
                    <option value="host">This exact host only</option>
                  </select>
                </div>
                {urls.length > 1 ? (
                  <button
                    className="btn"
                    type="button"
                    onClick={() => set('urls')(urls.filter((_, at) => at !== index))}
                  >
                    Remove<span className="visually-hidden"> website {index + 1}</span>
                  </button>
                ) : null}
              </div>
            ))}
            <button
              className="btn btn-quiet btn-inline"
              type="button"
              onClick={() => set('urls')([...urls, { url: '', match: 'domain' }])}
            >
              Add another website
            </button>
          </fieldset>
          <TextField
            label="Authenticator key (optional)"
            value={draft.totpSecret}
            onChange={set('totpSecret')}
            autoComplete="off"
            hint="The setup key a site gives you for two step login, if you want to keep it here."
          />
        </>
      ) : null}
      {draft.type === 'identity' ? (
        <fieldset className="group grid-2">
          <legend>Details</legend>
          {IDENTITY_KEYS.map((key) => (
            <TextField
              key={key}
              label={IDENTITY_LABELS[key]}
              value={draft.identity[key]}
              onChange={(value) => set('identity')({ ...draft.identity, [key]: value })}
              autoComplete="off"
            />
          ))}
        </fieldset>
      ) : null}
      <TextArea
        label={draft.type === 'note' ? 'Note' : 'Note (optional)'}
        value={draft.note}
        onChange={set('note')}
        rows={draft.type === 'note' ? 8 : 3}
      />
      <TextField
        label="Folder (optional)"
        value={draft.folder}
        onChange={set('folder')}
        list={folderListId}
        autoComplete="off"
      />
      <datalist id={folderListId}>
        {folders.map((folder) => (
          <option key={folder} value={folder} />
        ))}
      </datalist>
      <label className="check">
        <input
          type="checkbox"
          checked={draft.favorite}
          onChange={(event) => set('favorite')(event.target.checked)}
        />
        Favorite
      </label>
      {error ? (
        <p className="notice notice-error" role="alert">
          {saveErrorText(error)}
        </p>
      ) : null}
      <div className="dialog-actions">
        <button className="btn" type="button" onClick={onClose} disabled={saving}>
          Cancel
        </button>
        <button
          className="btn btn-primary"
          type="submit"
          disabled={saving || draft.name.trim() === ''}
        >
          {target.kind === 'edit' ? 'Save changes' : `Save ${TYPE_NOUN[draft.type]}`}
        </button>
      </div>
    </form>
  )
}
