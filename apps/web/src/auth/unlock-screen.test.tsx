// @vitest-environment jsdom
import type { Cache, CacheMeta } from '@securepass/shared/cache'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { UnlockScreen } from './unlock-screen'
import { unlockWithPassword } from './vault-session'

vi.mock('./vault-session')

const cache = {} as Cache
const meta = { email: 'me@example.com' } as CacheMeta
const session = { vaultKey: new Uint8Array(32), meta }

beforeEach(() => vi.resetAllMocks())

describe('UnlockScreen', () => {
  it('shows the account email and a trust warning', () => {
    render(<UnlockScreen cache={cache} meta={meta} onUnlocked={vi.fn()} />)
    expect(screen.getByRole('heading', { name: 'Unlock your vault' })).toBeInTheDocument()
    expect(screen.getByText('me@example.com')).toBeInTheDocument()
    expect(screen.getAllByText(/only on devices you trust/i).length).toBeGreaterThan(0)
  })

  it('disables Unlock until a password is typed', async () => {
    const user = userEvent.setup()
    render(<UnlockScreen cache={cache} meta={meta} onUnlocked={vi.fn()} />)
    const button = screen.getByRole('button', { name: 'Unlock' })
    expect(button).toBeDisabled()
    await user.type(screen.getByLabelText('Master password'), 'x')
    expect(button).toBeEnabled()
  })

  it('hands the session to onUnlocked on success (covers: AC-5)', async () => {
    vi.mocked(unlockWithPassword).mockResolvedValue({ ok: true, value: session })
    const onUnlocked = vi.fn()
    const user = userEvent.setup()
    render(<UnlockScreen cache={cache} meta={meta} onUnlocked={onUnlocked} />)

    await user.type(screen.getByLabelText('Master password'), 'secret{Enter}')

    await waitFor(() => expect(onUnlocked).toHaveBeenCalledWith(session))
    expect(unlockWithPassword).toHaveBeenCalledWith(cache, meta, 'secret')
  })

  it('shows one plain message and clears the field when the password is wrong (covers: AC-5)', async () => {
    vi.mocked(unlockWithPassword).mockResolvedValue({
      ok: false,
      error: { kind: 'wrong_password' },
    })
    const onUnlocked = vi.fn()
    const user = userEvent.setup()
    render(<UnlockScreen cache={cache} meta={meta} onUnlocked={onUnlocked} />)

    await user.type(screen.getByLabelText('Master password'), 'nope{Enter}')

    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That password did not unlock the vault.',
    )
    expect(screen.getByLabelText('Master password')).toHaveValue('')
    expect(screen.getByLabelText('Master password')).toBeInvalid()
    expect(onUnlocked).not.toHaveBeenCalled()
  })

  it('shows the same message for a crypto failure, so the cause is not revealed', async () => {
    vi.mocked(unlockWithPassword).mockResolvedValue({ ok: false, error: { kind: 'crypto' } })
    const user = userEvent.setup()
    render(<UnlockScreen cache={cache} meta={meta} onUnlocked={vi.fn()} />)
    await user.type(screen.getByLabelText('Master password'), 'x{Enter}')
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'That password did not unlock the vault.',
    )
  })

  it('shows a notice passed from the app', () => {
    render(<UnlockScreen cache={cache} meta={meta} notice="Locked." onUnlocked={vi.fn()} />)
    expect(screen.getByRole('status')).toHaveTextContent('Locked.')
  })

  it('hides the password until Show is pressed, and Show announces its pressed state', async () => {
    const user = userEvent.setup()
    render(<UnlockScreen cache={cache} meta={meta} onUnlocked={vi.fn()} />)
    const field = screen.getByLabelText('Master password')
    expect(field).toHaveAttribute('type', 'password')

    const toggle = screen.getByRole('button', { name: /show\s*master password/i })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')
    await user.click(toggle)

    expect(field).toHaveAttribute('type', 'text')
    expect(screen.getByRole('button', { name: /hide\s*master password/i })).toHaveAttribute(
      'aria-pressed',
      'true',
    )
  })

  it('focuses the password field on load and keeps the helper username input out of the accessibility tree', () => {
    render(<UnlockScreen cache={cache} meta={meta} onUnlocked={vi.fn()} />)
    expect(screen.getByLabelText('Master password')).toHaveFocus()
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })
})
