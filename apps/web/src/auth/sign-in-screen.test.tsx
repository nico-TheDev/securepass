// @vitest-environment jsdom
import type { Cache } from '@securepass/shared/cache'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { SignInScreen } from './sign-in-screen'
import { type SignInError, signIn } from './vault-session'

vi.mock('./vault-session')

const cache = {} as Cache
const session = { vaultKey: new Uint8Array(32), meta: {} as never }

beforeEach(() => vi.resetAllMocks())

const fill = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.type(screen.getByLabelText('Email'), 'me@example.com')
  await user.type(screen.getByLabelText('Master password'), 'hunter2hunter2')
  await user.click(screen.getByRole('button', { name: 'Sign in' }))
}

describe('SignInScreen', () => {
  it('signs in with the typed email and password and hands over the session', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, value: session })
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    render(<SignInScreen cache={cache} onSignedIn={onSignedIn} onSetup={vi.fn()} />)

    await fill(user)

    await waitFor(() => expect(onSignedIn).toHaveBeenCalledWith(session))
    expect(signIn).toHaveBeenCalledWith(cache, 'me@example.com', 'hunter2hunter2', {
      totp_code: '',
    })
  })

  it('sends the authenticator code, or a recovery code when chosen (covers: AC-4)', async () => {
    vi.mocked(signIn).mockResolvedValue({ ok: true, value: session })
    const user = userEvent.setup()
    render(<SignInScreen cache={cache} onSignedIn={vi.fn()} onSetup={vi.fn()} />)
    await user.type(screen.getByLabelText('Authenticator code'), '123456')
    await fill(user)
    await waitFor(() =>
      expect(signIn).toHaveBeenLastCalledWith(cache, 'me@example.com', 'hunter2hunter2', {
        totp_code: '123456',
      }),
    )

    await user.clear(screen.getByLabelText('Email'))
    await user.click(screen.getByRole('button', { name: 'Use a recovery code instead' }))
    await user.type(screen.getByLabelText('Recovery code'), 'ABCD')
    await fill(user)
    await waitFor(() =>
      expect(signIn).toHaveBeenLastCalledWith(cache, 'me@example.com', 'hunter2hunter2', {
        recovery_code: 'ABCD',
      }),
    )
  })

  it.each<[SignInError, RegExp]>([
    [{ kind: 'wrong_credentials' }, /email, master password, or code was not accepted/i],
    [{ kind: 'network' }, /could not reach the server/i],
    [{ kind: 'crypto' }, /settings this app will not accept/i],
    [{ kind: 'server' }, /could not finish this/i],
    [{ kind: 'rate_limited', retryAfter: 120 }, /wait 2 minute/i],
  ])('shows an alert for %o and clears the password', async (error, message) => {
    vi.mocked(signIn).mockResolvedValue({ ok: false, error })
    const onSignedIn = vi.fn()
    const user = userEvent.setup()
    render(<SignInScreen cache={cache} onSignedIn={onSignedIn} onSetup={vi.fn()} />)

    await fill(user)

    expect(await screen.findByRole('alert')).toHaveTextContent(message)
    expect(screen.getByLabelText('Master password')).toHaveValue('')
    expect(screen.getByLabelText('Email')).toHaveValue('me@example.com')
    expect(onSignedIn).not.toHaveBeenCalled()
  })

  it('disables the form and shows progress while signing in', async () => {
    let finish: (value: never) => void = () => {}
    vi.mocked(signIn).mockReturnValue(
      new Promise((resolve) => {
        finish = resolve as never
      }),
    )
    const user = userEvent.setup()
    render(<SignInScreen cache={cache} onSignedIn={vi.fn()} onSetup={vi.fn()} />)

    await fill(user)

    expect(await screen.findByRole('button', { name: 'Signing in…' })).toBeDisabled()
    expect(screen.getByLabelText('Email')).toBeDisabled()
    finish({ ok: false, error: { kind: 'server' } } as never)
    expect(await screen.findByRole('button', { name: 'Sign in' })).toBeEnabled()
  })

  it('lets the user go back to creating a vault', async () => {
    const onSetup = vi.fn()
    const user = userEvent.setup()
    render(<SignInScreen cache={cache} onSignedIn={vi.fn()} onSetup={onSetup} />)
    await user.click(screen.getByRole('button', { name: 'Create a new vault' }))
    expect(onSetup).toHaveBeenCalled()
  })

  it('does not submit without an email and password', async () => {
    const user = userEvent.setup()
    render(<SignInScreen cache={cache} onSignedIn={vi.fn()} onSetup={vi.fn()} />)
    await user.click(screen.getByRole('button', { name: 'Sign in' }))
    expect(signIn).not.toHaveBeenCalled()
  })
})
