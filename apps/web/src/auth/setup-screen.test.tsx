// @vitest-environment jsdom
import type { Cache } from '@securepass/shared/cache'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SetupScreen } from './setup-screen'
import { completeSetup, type PendingSetup, prepareSetup, type SetupError } from './vault-session'

vi.mock('./vault-session')

const cache = {} as Cache
const pending = {
  request: { email: 'me@example.com' },
  kit: { groups: ['AAAA', 'BBBB', 'CCCC', 'WXYZ'], display: 'AAAA-BBBB-CCCC-WXYZ' },
} as unknown as PendingSetup
const session = { vaultKey: new Uint8Array(32), meta: {} as never }

beforeEach(() => vi.resetAllMocks())

type User = ReturnType<typeof userEvent.setup>
const fillForm = async (user: User, confirm = 'a long master password') => {
  await user.type(screen.getByLabelText('Email'), 'me@example.com')
  await user.type(screen.getByLabelText('Master password'), 'a long master password')
  await user.type(screen.getByLabelText('Confirm master password'), confirm)
  await user.type(screen.getByLabelText('Setup token'), 'setup-token')
}

const toKitStep = async (user: User, props: Partial<Parameters<typeof SetupScreen>[0]> = {}) => {
  vi.mocked(prepareSetup).mockResolvedValue({ ok: true, value: pending })
  render(<SetupScreen cache={cache} onDone={vi.fn()} onSignIn={vi.fn()} {...props} />)
  await fillForm(user)
  await user.click(screen.getByRole('button', { name: 'Continue' }))
  await screen.findByRole('heading', { name: 'Save your recovery kit' })
}

describe('SetupScreen account step', () => {
  it('shows a mismatch error linked to the confirm field and disables Continue', async () => {
    const user = userEvent.setup()
    render(<SetupScreen cache={cache} onDone={vi.fn()} onSignIn={vi.fn()} />)

    await fillForm(user, 'something else')

    const confirm = screen.getByLabelText('Confirm master password')
    expect(confirm).toBeInvalid()
    expect(confirm).toHaveAccessibleDescription('The two passwords do not match.')
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled()
  })

  it('shows the strength meter only once a password is typed', async () => {
    const user = userEvent.setup()
    render(<SetupScreen cache={cache} onDone={vi.fn()} onSignIn={vi.fn()} />)
    expect(screen.queryByText(/Strength:/)).not.toBeInTheDocument()
    await user.type(screen.getByLabelText('Master password'), 'abc')
    expect(screen.getByText(/Strength:/)).toBeInTheDocument()
  })

  it('prepares the account from the typed email and password', async () => {
    const user = userEvent.setup()
    await toKitStep(user)
    expect(prepareSetup).toHaveBeenCalledWith('me@example.com', 'a long master password')
  })

  it('shows an alert and stays on the form when key creation fails', async () => {
    vi.mocked(prepareSetup).mockResolvedValue({ ok: false, error: { kind: 'crypto' } })
    const user = userEvent.setup()
    render(<SetupScreen cache={cache} onDone={vi.fn()} onSignIn={vi.fn()} />)

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Continue' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(/could not create the keys/i)
    expect(screen.getByRole('heading', { name: 'Create your vault' })).toBeInTheDocument()
  })

  it('shows a notice when the device was signed out', () => {
    render(
      <SetupScreen
        cache={cache}
        notice="This device was signed out."
        onDone={vi.fn()}
        onSignIn={vi.fn()}
      />,
    )
    expect(screen.getByRole('status')).toHaveTextContent('This device was signed out.')
  })

  it('sends the user to sign in', async () => {
    const onSignIn = vi.fn()
    const user = userEvent.setup()
    render(<SetupScreen cache={cache} onDone={vi.fn()} onSignIn={onSignIn} />)
    await user.click(screen.getByRole('button', { name: 'I already have an account' }))
    expect(onSignIn).toHaveBeenCalled()
  })
})

describe('SetupScreen recovery kit step', () => {
  it('shows the key in groups and does not call the server yet (covers: AC-20)', async () => {
    const user = userEvent.setup()
    await toKitStep(user)

    const list = screen.getByRole('list', { name: /recovery key/i })
    expect(list).toHaveTextContent('AAAABBBBCCCCWXYZ')
    expect(completeSetup).not.toHaveBeenCalled()
  })

  it('keeps Finish disabled until the last group is typed, ignoring case and spaces', async () => {
    const user = userEvent.setup()
    await toKitStep(user)
    const finish = screen.getByRole('button', { name: 'Finish setup' })
    const input = screen.getByLabelText(/type the last group/i)

    expect(finish).toBeDisabled()
    await user.type(input, 'wxy')
    expect(finish).toBeDisabled()
    await user.clear(input)
    await user.type(input, ' wxyz ')
    expect(finish).toBeEnabled()
  })

  it('rejects a wrong last group', async () => {
    const user = userEvent.setup()
    await toKitStep(user)
    await user.type(screen.getByLabelText(/type the last group/i), 'AAAA')
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeDisabled()
  })

  it('completes setup with the token and hands over the session (covers: AC-1)', async () => {
    vi.mocked(completeSetup).mockResolvedValue({ ok: true, value: session })
    const onDone = vi.fn()
    const user = userEvent.setup()
    await toKitStep(user, { onDone })

    await user.type(screen.getByLabelText(/type the last group/i), 'WXYZ')
    await user.click(screen.getByRole('button', { name: 'Finish setup' }))

    await waitFor(() => expect(onDone).toHaveBeenCalledWith(session))
    expect(completeSetup).toHaveBeenCalledWith(cache, pending, 'setup-token')
  })

  it('does not keep the master password after the keys exist', async () => {
    const user = userEvent.setup()
    await toKitStep(user)
    expect(screen.queryByDisplayValue('a long master password')).not.toBeInTheDocument()
  })

  it.each<[SetupError['kind'], RegExp]>([
    ['bad_token', /setup token was not accepted/i],
    ['network', /could not reach the server/i],
    ['server', /could not finish setup/i],
  ])('shows an alert for %s and lets the user retry', async (kind, message) => {
    vi.mocked(completeSetup).mockResolvedValue({ ok: false, error: { kind } })
    const user = userEvent.setup()
    await toKitStep(user)

    await user.type(screen.getByLabelText(/type the last group/i), 'WXYZ')
    await user.click(screen.getByRole('button', { name: 'Finish setup' }))

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByRole('button', { name: 'Finish setup' })).toBeEnabled()
  })

  it('offers Sign in when an account already exists (covers: AC-1)', async () => {
    vi.mocked(completeSetup).mockResolvedValue({ ok: false, error: { kind: 'account_exists' } })
    const onSignIn = vi.fn()
    const user = userEvent.setup()
    await toKitStep(user, { onSignIn })

    await user.type(screen.getByLabelText(/type the last group/i), 'WXYZ')
    await user.click(screen.getByRole('button', { name: 'Finish setup' }))
    await user.click(await screen.findByRole('button', { name: 'Sign in' }))

    expect(onSignIn).toHaveBeenCalled()
  })

  it('downloads the kit file with the key, email, and file name', async () => {
    const createObjectURL = vi.fn(() => 'blob:kit')
    const revokeObjectURL = vi.fn()
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL, revokeObjectURL }))
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    const user = userEvent.setup()
    await toKitStep(user)

    await user.click(screen.getByRole('button', { name: /download securepass-recovery-kit\.txt/i }))

    expect(click).toHaveBeenCalledTimes(1)
    const blob = (createObjectURL.mock.calls[0] as unknown as [Blob])[0]
    const text = await blob.text()
    expect(text).toContain('AAAA-BBBB-CCCC-WXYZ')
    expect(text).toContain('me@example.com')
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:kit')
    click.mockRestore()
    vi.unstubAllGlobals()
  })
})
