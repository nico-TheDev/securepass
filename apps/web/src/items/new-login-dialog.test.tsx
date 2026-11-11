// @vitest-environment jsdom
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { beforeAll, describe, expect, it, vi } from 'vitest'
import { NewLoginDialog } from './new-login-dialog'
import type { LoginDraft } from './vault-items'

// jsdom has no modal dialog support, so stand in for the browser's open and close.
beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

const Harness = ({ onSave }: { onSave: (draft: LoginDraft) => Promise<boolean> }) => {
  const [open, setOpen] = useState(true)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>
        Open
      </button>
      <NewLoginDialog open={open} onClose={() => setOpen(false)} onSave={onSave} />
    </>
  )
}

describe('NewLoginDialog', () => {
  it('is a dialog named by its title, with every field labelled', () => {
    render(<Harness onSave={vi.fn()} />)
    const dialog = screen.getByRole('dialog', { name: 'New login' })
    expect(dialog).toBeInTheDocument()
    for (const label of ['Name', 'Username', 'Password', 'Website', 'Note'])
      expect(screen.getByLabelText(label)).toBeInTheDocument()
  })

  it('disables Save until the name has something other than spaces', async () => {
    const user = userEvent.setup()
    render(<Harness onSave={vi.fn()} />)
    const save = screen.getByRole('button', { name: 'Save login' })
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), '   ')
    expect(save).toBeDisabled()
    await user.type(screen.getByLabelText('Name'), 'Bank')
    expect(save).toBeEnabled()
  })

  it('saves the typed draft and closes (covers: AC-7)', async () => {
    const onSave = vi.fn().mockResolvedValue(true)
    const user = userEvent.setup()
    render(<Harness onSave={onSave} />)

    await user.type(screen.getByLabelText('Name'), 'Bank')
    await user.type(screen.getByLabelText('Username'), 'me')
    await user.type(screen.getByLabelText('Password'), 'pw')
    await user.type(screen.getByLabelText('Website'), 'https://bank.com')
    await user.type(screen.getByLabelText('Note'), 'hi')
    await user.click(screen.getByRole('button', { name: 'Save login' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSave).toHaveBeenCalledWith({
      name: 'Bank',
      username: 'me',
      password: 'pw',
      url: 'https://bank.com',
      note: 'hi',
    })
  })

  it('stays open and shows an alert when saving fails', async () => {
    const user = userEvent.setup()
    render(<Harness onSave={vi.fn().mockResolvedValue(false)} />)

    await user.type(screen.getByLabelText('Name'), 'Bank')
    await user.click(screen.getByRole('button', { name: 'Save login' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not be saved/i)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('closes without saving on Cancel', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<Harness onSave={onSave} />)
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(onSave).not.toHaveBeenCalled()
  })

  it('starts with an empty form each time it opens', async () => {
    const user = userEvent.setup()
    render(<Harness onSave={vi.fn()} />)
    await user.type(screen.getByLabelText('Name'), 'Leftover')
    await user.click(screen.getByRole('button', { name: 'Cancel' }))
    await user.click(screen.getByRole('button', { name: 'Open', hidden: true }))
    expect(await screen.findByLabelText('Name')).toHaveValue('')
  })
})
