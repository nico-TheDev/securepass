import { type FormEvent, useEffect, useRef, useState } from 'react'
import { PasswordField, TextArea, TextField } from '../ui/text-field'
import type { LoginDraft } from './vault-items'

const EMPTY: LoginDraft = { name: '', username: '', password: '', url: '', note: '' }

type Props = {
  readonly open: boolean
  readonly onClose: () => void
  readonly onSave: (draft: LoginDraft) => Promise<boolean>
}

/** A native modal dialog: it traps focus, closes on Escape, and returns focus to the button that opened it. */
export function NewLoginDialog({ open, onClose, onSave }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const [draft, setDraft] = useState<LoginDraft>(EMPTY)
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) {
      setDraft(EMPTY)
      setFailed(false)
      dialog.showModal()
    }
    if (!open && dialog.open) dialog.close()
  }, [open])

  const set = (key: keyof LoginDraft) => (value: string) =>
    setDraft((current) => ({ ...current, [key]: value }))

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    setFailed(false)
    const saved = await onSave(draft)
    setSaving(false)
    if (saved) onClose()
    else setFailed(true)
  }

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby="new-login-title">
      <form className="form" onSubmit={submit}>
        <h2 id="new-login-title">New login</h2>
        <TextField label="Name" value={draft.name} onChange={set('name')} required autoFocus />
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
        />
        <TextField
          label="Website"
          type="url"
          value={draft.url}
          onChange={set('url')}
          hint="Optional. For example https://example.com"
          autoComplete="off"
        />
        <TextArea label="Note" value={draft.note} onChange={set('note')} />
        {failed ? (
          <p className="notice notice-error" role="alert">
            This login could not be saved. It may be too large, or the name may be empty.
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
            Save login
          </button>
        </div>
      </form>
    </dialog>
  )
}
