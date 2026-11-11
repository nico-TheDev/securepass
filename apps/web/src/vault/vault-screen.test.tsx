// @vitest-environment jsdom
import { newVaultKey } from '@securepass/crypto'
import {
  type Cache,
  type CacheMeta,
  openCache,
  readPending,
  writeMeta,
} from '@securepass/shared/cache'
import { syncOnce } from '@securepass/shared/sync'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Session } from '../auth/vault-session'
import { createLogin } from '../items/vault-items'
import { VaultScreen } from './vault-screen'

vi.mock('@securepass/shared/sync', () => ({ syncOnce: vi.fn() }))

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function showModal(this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function close(this: HTMLDialogElement) {
    this.removeAttribute('open')
    this.dispatchEvent(new Event('close'))
  }
})

const meta: CacheMeta = {
  account_id: 'acc',
  email: 'me@example.com',
  kdf: { alg: 'argon2id', m: 65536, t: 3, p: 1 },
  kdf_salt: 'c2FsdA',
  wrapped_vault_key: 'w',
  last_revision: 0,
  token: 't',
  device_id: 'device-1',
  seen_seq: {},
}

let cache: Cache
let session: Session
let dbCount = 0

beforeEach(async () => {
  vi.mocked(syncOnce).mockResolvedValue({ ok: true, value: undefined } as never)
  cache = await openCache(`vault-screen-${dbCount++}`)
  await writeMeta(cache, meta)
  session = { vaultKey: newVaultKey(), meta }
})
afterEach(() => {
  cache.close()
  vi.resetAllMocks()
})

const renderVault = (props: Partial<Parameters<typeof VaultScreen>[0]> = {}) =>
  render(
    <VaultScreen cache={cache} session={session} onLock={vi.fn()} onRevoked={vi.fn()} {...props} />,
  )

describe('VaultScreen', () => {
  it('shows the empty state when the vault has no logins', async () => {
    renderVault()
    expect(await screen.findByRole('heading', { name: 'Your vault is empty' })).toBeInTheDocument()
  })

  it('shows logins already in the cache without waiting for sync (covers: AC-10)', async () => {
    await createLogin(cache, session.vaultKey, {
      name: 'Bank',
      username: 'me',
      password: 'pw',
      url: '',
      note: '',
    })
    vi.mocked(syncOnce).mockReturnValue(new Promise(() => {}))

    renderVault()

    expect(await screen.findByText('Bank')).toBeInTheDocument()
    expect(screen.getByText('Not synced yet', { selector: '.tag' })).toBeInTheDocument()
  })

  it('adds a login through the dialog, shows it, and triggers a sync (covers: AC-7, AC-8)', async () => {
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: 'Your vault is empty' })
    const callsBefore = vi.mocked(syncOnce).mock.calls.length

    await user.click(screen.getByRole('button', { name: 'New login' }))
    const dialog = await screen.findByRole('dialog', { name: 'New login' })
    await user.type(within(dialog).getByLabelText('Name'), 'Mail')
    await user.type(within(dialog).getByLabelText('Password'), 'pw')
    await user.click(within(dialog).getByRole('button', { name: 'Save login' }))

    expect(await screen.findByRole('list', { name: 'Logins' })).toHaveTextContent('Mail')
    expect(await readPending(cache)).toHaveLength(1)
    await waitFor(() => expect(vi.mocked(syncOnce).mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('locks when Lock is pressed', async () => {
    const onLock = vi.fn()
    const user = userEvent.setup()
    renderVault({ onLock })
    await user.click(screen.getByRole('button', { name: 'Lock' }))
    expect(onLock).toHaveBeenCalled()
  })

  it('shows the offline status when sync cannot reach the server (covers: AC-10)', async () => {
    vi.mocked(syncOnce).mockResolvedValue({ ok: false, error: { kind: 'network' } } as never)
    renderVault()
    expect(
      await screen.findByText(/Offline\. Changes are saved on this device/),
    ).toBeInTheDocument()
  })

  it('tells the user the session expired and that changes are kept (covers: AC-22)', async () => {
    vi.mocked(syncOnce).mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', code: 'expired' },
    } as never)
    renderVault()
    expect(await screen.findByText(/Session expired.*changes are kept/i)).toBeInTheDocument()
  })

  it('calls onRevoked when the server revoked this device (covers: AC-22)', async () => {
    vi.mocked(syncOnce).mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', code: 'revoked' },
    } as never)
    const onRevoked = vi.fn()
    renderVault({ onRevoked })
    await waitFor(() => expect(onRevoked).toHaveBeenCalledTimes(1))
  })
})
