import type { RecoveryKit } from '@securepass/crypto'
import { useId } from 'react'
import { env } from '../env'
import { downloadText } from '../ui/download'
import { RECOVERY_KIT_FILE_NAME, recoveryKitText } from './recovery-kit-file'

type Props = {
  readonly kit: RecoveryKit
  readonly email: string
  /** What the user has typed into the confirm field. */
  readonly typed: string
  readonly onTyped: (value: string) => void
  readonly disabled: boolean
}

/** True when the typed text is the last group of the recovery key. */
export const kitConfirmed = (kit: RecoveryKit, typed: string): boolean =>
  typed.trim().toUpperCase() === (kit.groups.at(-1) ?? '')

/**
 * The recovery kit ceremony: the key in groups of four, a download button, and a field where the
 * last group must be retyped before anything continues.
 */
export function RecoveryKitPanel({ kit, email, typed, onTyped, disabled }: Props) {
  const confirmId = useId()
  const download = () =>
    downloadText(
      RECOVERY_KIT_FILE_NAME,
      recoveryKitText(kit, email, env.VITE_API_URL || window.location.origin, new Date()),
    )

  return (
    <>
      <ol className="kit-key" aria-label="Recovery key, in groups of four characters">
        {kit.groups.map((group, index) => (
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
          onChange={(event) => onTyped(event.target.value)}
          autoComplete="off"
          autoCapitalize="characters"
          spellCheck={false}
          maxLength={8}
          disabled={disabled}
          aria-describedby={`${confirmId}-hint`}
        />
        <p id={`${confirmId}-hint`} className="field-hint">
          The last group is the final four characters of the key above.
        </p>
      </div>
    </>
  )
}
