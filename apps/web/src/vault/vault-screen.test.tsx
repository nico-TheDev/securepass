// @vitest-environment jsdom
import { newVaultKey } from '@securepass/crypto'
import {
  type Cache,
  type CacheMeta,
  openCache,
  readPending,
  writeMeta,
} from '@securepass/shared/cache'
import { createItem, emptyDraft, loadVaultItems, syncVault } from '@securepass/vault'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { api } from '../auth/api'
import type { Session } from '../auth/vault-session'
import { VaultScreen } from './vault-screen'

vi.mock('@securepass/vault', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@securepass/vault')>()),
  syncVault: vi.fn(),
}))

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

const synced = { ok: true, value: { pushed: 0, pulled: 0, rejected: [], fullResync: false } }

beforeEach(async () => {
  vi.mocked(syncVault).mockResolvedValue(synced as never)
  cache = await openCache(`vault-screen-${dbCount++}`)
  await writeMeta(cache, meta)
  session = { vaultKey: newVaultKey(), meta }
})
afterEach(() => {
  cache.close()
  vi.restoreAllMocks()
  vi.mocked(syncVault).mockReset()
})

const renderVault = (props: Partial<Parameters<typeof VaultScreen>[0]> = {}) =>
  render(
    <VaultScreen cache={cache} session={session} onLock={vi.fn()} onRevoked={vi.fn()} {...props} />,
  )

const addLogin = (name: string, extra: Partial<ReturnType<typeof emptyDraft>> = {}) =>
  createItem(cache, session.vaultKey, {
    ...emptyDraft('login'),
    name,
    username: 'me',
    password: 'pw-1',
    ...extra,
  })

const onlyPayload = async () => {
  const [item] = await loadVaultItems(cache, session.vaultKey)
  if (item?.kind !== 'item') throw new Error('expected one item')
  return item.payload
}

describe('VaultScreen', () => {
  it('shows the empty state when the vault has no items', async () => {
    renderVault()
    expect(await screen.findByRole('heading', { name: 'Your vault is empty' })).toBeInTheDocument()
  })

  it('shows items already in the cache without waiting for sync (covers: AC-10)', async () => {
    await addLogin('Bank')
    vi.mocked(syncVault).mockReturnValue(new Promise(() => {}))

    renderVault()

    expect(await screen.findByText('Bank')).toBeInTheDocument()
    expect(screen.getByText('Not synced yet', { selector: '.tag' })).toBeInTheDocument()
  })

  it('adds a login through the dialog, shows it, and triggers a sync (covers: AC-7, AC-8)', async () => {
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: 'Your vault is empty' })
    const callsBefore = vi.mocked(syncVault).mock.calls.length

    await user.click(screen.getByRole('button', { name: 'New login' }))
    const dialog = await screen.findByRole('dialog', { name: 'New login' })
    await user.type(within(dialog).getByLabelText('Name'), 'Mail')
    await user.type(within(dialog).getByLabelText('Password'), 'pw')
    await user.type(within(dialog).getByLabelText('Website 1'), 'Example.com/login?x=1')
    await user.click(within(dialog).getByRole('button', { name: 'Save login' }))

    expect(await screen.findByRole('list', { name: 'All items' })).toHaveTextContent('Mail')
    expect(await readPending(cache)).toHaveLength(1)
    expect((await onlyPayload()).login?.urls).toEqual([
      { url: 'https://example.com/login', match: 'domain' },
    ])
    await waitFor(() => expect(vi.mocked(syncVault).mock.calls.length).toBeGreaterThan(callsBefore))
  })

  it('creates a secure note and an identity (covers: AC-7)', async () => {
    const user = userEvent.setup()
    renderVault()
    await screen.findByRole('heading', { name: 'Your vault is empty' })

    await user.click(screen.getByRole('button', { name: 'New note' }))
    const note = await screen.findByRole('dialog', { name: 'New note' })
    await user.type(within(note).getByLabelText('Name'), 'Wifi')
    await user.type(within(note).getByLabelText('Note'), 'the passphrase')
    await user.click(within(note).getByRole('button', { name: 'Save note' }))
    await screen.findByRole('heading', { name: 'Wifi' })

    await user.click(screen.getByRole('button', { name: 'New identity' }))
    const identity = await screen.findByRole('dialog', { name: 'New identity' })
    await user.type(within(identity).getByLabelText('Name'), 'Me')
    await user.type(within(identity).getByLabelText('First name'), 'Ada')
    await user.click(within(identity).getByRole('button', { name: 'Save identity' }))
    await screen.findByRole('heading', { name: 'Me' })

    const items = await loadVaultItems(cache, session.vaultKey)
    const types = items.map((item) => (item.kind === 'item' ? item.payload.type : 'damaged'))
    expect(types.toSorted()).toEqual(['identity', 'note'])
  })

  it('keeps the password hidden until Show, and edits keep the old password in the history (covers: AC-12)', async () => {
    await addLogin('Bank')
    const user = userEvent.setup()
    renderVault()
    await user.click(await screen.findByRole('button', { name: /Bank/ }))

    expect(screen.queryByText('pw-1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /^Show\s*password$/ }))
    expect(screen.getByText('pw-1')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit' }))
    const dialog = await screen.findByRole('dialog', { name: 'Edit login' })
    const password = within(dialog).getByLabelText('Password')
    await user.clear(password)
    await user.type(password, 'pw-2')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { name: 'Previous passwords' })).toBeInTheDocument()
    const payload = await onlyPayload()
    expect(payload.login?.password).toBe('pw-2')
    expect(payload.password_history?.map((entry) => entry.password)).toEqual(['pw-1'])
    expect(payload.seq).toBe(2)
  })

  it('moves an item to the trash and restores it (covers: AC-11)', async () => {
    await addLogin('Bank')
    const user = userEvent.setup()
    renderVault()
    await user.click(await screen.findByRole('button', { name: /Bank/ }))
    await user.click(screen.getByRole('button', { name: 'Move to trash' }))

    await waitFor(async () => expect((await onlyPayload()).trashed).toBe(true))
    await waitFor(() => expect(screen.queryByRole('list', { name: 'All items' })).toBeNull())
    await user.click(screen.getByRole('button', { name: 'Trash (1)' }))
    await user.click(await screen.findByRole('button', { name: /Bank/ }))
    expect(screen.getByText(/This item is in the trash/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Restore' }))
    await waitFor(async () => expect((await onlyPayload()).trashed).toBe(false))
  })

  it('empties the trash only with a fresh authenticator code (covers: AC-11)', async () => {
    await addLogin('Bank')
    const emptyTrash = vi.spyOn(api, 'emptyTrash').mockResolvedValue({ ok: true, value: undefined })
    const user = userEvent.setup()
    renderVault()
    await user.click(await screen.findByRole('button', { name: /Bank/ }))
    await user.click(screen.getByRole('button', { name: 'Move to trash' }))
    await user.click(await screen.findByRole('button', { name: 'Trash (1)' }))
    await user.click(screen.getByRole('button', { name: 'Empty the trash now' }))

    const dialog = await screen.findByRole('dialog', { name: 'Empty the trash' })
    const confirm = within(dialog).getByRole('button', { name: 'Empty the trash' })
    expect(confirm).toBeDisabled()
    await user.type(within(dialog).getByLabelText('Authenticator code'), '123 456')
    await user.click(confirm)
    await waitFor(() => expect(emptyTrash).toHaveBeenCalledWith('t', '123456'))
  })

  it('filters by search and by folder', async () => {
    await addLogin('Bank', { folder: 'Money' })
    await addLogin('Mail', { folder: 'Work', username: 'ada' })
    const user = userEvent.setup()
    renderVault()
    await screen.findByText('Bank')

    await user.type(screen.getByLabelText('Search'), 'ada')
    expect(screen.queryByText('Bank')).not.toBeInTheDocument()
    expect(screen.getByText('Mail')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Search'))

    await user.click(screen.getByRole('button', { name: 'Money' }))
    expect(screen.getByRole('list', { name: 'Money' })).toHaveTextContent('Bank')
    expect(screen.queryByText('Mail')).not.toBeInTheDocument()
  })

  it('locks when Lock is pressed', async () => {
    const onLock = vi.fn()
    const user = userEvent.setup()
    renderVault({ onLock })
    await user.click(screen.getByRole('button', { name: 'Lock' }))
    expect(onLock).toHaveBeenCalled()
  })

  it('shows the offline status when sync cannot reach the server (covers: AC-10)', async () => {
    vi.mocked(syncVault).mockResolvedValue({ ok: false, error: { kind: 'network' } } as never)
    renderVault()
    expect(
      await screen.findByText(/Offline\. Changes are saved on this device/),
    ).toBeInTheDocument()
  })

  it('tells the user the session expired, keeps the changes, and offers to sign in again (covers: AC-22)', async () => {
    await addLogin('Bank')
    vi.mocked(syncVault).mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', code: 'expired' },
    } as never)
    const user = userEvent.setup()
    renderVault()
    expect(await screen.findByText(/Session expired.*changes are kept/i)).toBeInTheDocument()
    expect(await readPending(cache)).toHaveLength(1)
    await user.click(screen.getByRole('button', { name: 'Sign in again' }))
    expect(await screen.findByRole('dialog', { name: 'Sign in again' })).toBeInTheDocument()
  })

  it('calls onRevoked when the server revoked this device (covers: AC-22)', async () => {
    vi.mocked(syncVault).mockResolvedValue({
      ok: false,
      error: { kind: 'unauthorized', code: 'revoked' },
    } as never)
    const onRevoked = vi.fn()
    renderVault({ onRevoked })
    await waitFor(() => expect(onRevoked).toHaveBeenCalledTimes(1))
  })

  it('opens the generator and makes a password of the default length (covers: AC-16)', async () => {
    const user = userEvent.setup()
    renderVault()
    await user.click(screen.getByRole('button', { name: 'Generator' }))
    const output = await screen.findByLabelText('Generated value')
    await waitFor(() => expect(output.textContent).toHaveLength(20))
    const first = output.textContent
    await user.click(screen.getByRole('button', { name: 'Make another' }))
    expect(output.textContent).not.toBe(first)
  })
})
