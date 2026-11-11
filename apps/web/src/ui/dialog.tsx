import { type ReactNode, useEffect, useId, useRef } from 'react'

type Props = {
  readonly open: boolean
  readonly title: string
  readonly onClose: () => void
  readonly children: ReactNode
  /** A wider dialog, for forms with many fields. */
  readonly wide?: boolean
}

/**
 * A native modal dialog: it traps focus, closes on Escape, and returns focus to the control that
 * opened it. Its content is only mounted while it is open, so every opening starts fresh.
 */
export function Dialog({ open, title, onClose, children, wide = false }: Props) {
  const ref = useRef<HTMLDialogElement>(null)
  const titleId = useId()

  useEffect(() => {
    const dialog = ref.current
    if (!dialog) return
    if (open && !dialog.open) dialog.showModal()
    if (!open && dialog.open) dialog.close()
  }, [open])

  return (
    <dialog ref={ref} onClose={onClose} aria-labelledby={titleId} data-wide={wide}>
      {open ? (
        <div className="form">
          <h2 id={titleId}>{title}</h2>
          {children}
        </div>
      ) : null}
    </dialog>
  )
}
