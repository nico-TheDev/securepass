// @vitest-environment jsdom
import { emptyDraft, type ItemDraft, newItemPayload, type VaultItem } from '@securepass/vault'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ItemList } from './item-list'

const item = (id: string, draft: Partial<ItemDraft>, extra: Partial<VaultItem> = {}): VaultItem =>
  ({
    kind: 'item',
    id,
    revision: 1,
    pending: false,
    deletedAt: null,
    rolledBack: false,
    payload: newItemPayload({ ...emptyDraft(draft.type ?? 'login'), ...draft }, 'd', new Date()),
    ...extra,
  }) as VaultItem

const show = (items: VaultItem[], onSelect = vi.fn()) =>
  render(<ItemList items={items} onSelect={onSelect} />)

describe('ItemList', () => {
  it('shows the name, username, and website host of each login', () => {
    show([
      item('1', {
        name: 'Bank',
        username: 'me',
        urls: [{ url: 'https://www.bank.com/login', match: 'domain' }],
      }),
    ])
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Bank')).toBeInTheDocument()
    expect(within(row).getByText('me · www.bank.com')).toBeInTheDocument()
  })

  it('never prints a password or the text of a note', () => {
    show([
      item('1', { name: 'Bank', password: 'hunter2-secret' }),
      item('2', { type: 'note', name: 'Wifi', note: 'the-note-secret' }),
    ])
    expect(screen.queryByText(/hunter2-secret/)).not.toBeInTheDocument()
    expect(screen.queryByText(/the-note-secret/)).not.toBeInTheDocument()
    expect(screen.getByText('Secure note')).toBeInTheDocument()
  })

  it('says so when a login has no username or website', () => {
    show([item('1', { name: 'Bare' })])
    expect(screen.getByText('No username or website')).toBeInTheDocument()
  })

  it('tags the type in words, and marks favorites and unsent writes', () => {
    show([
      item('1', { name: 'New', favorite: true }, { pending: true }),
      item('2', { type: 'identity', name: 'Me' }),
    ])
    expect(screen.getAllByText('Not synced yet')).toHaveLength(1)
    expect(screen.getByText('Login')).toBeInTheDocument()
    expect(screen.getAllByText('Identity').length).toBeGreaterThan(0)
    expect(screen.getByRole('img', { name: 'Favorite' })).toBeInTheDocument()
  })

  it('flags an item the server tried to roll back (covers: AC-6)', () => {
    show([item('1', { name: 'Rolled' }, { rolledBack: true })])
    expect(screen.getByText('Needs a look')).toBeInTheDocument()
  })

  it('opens an item from the keyboard or a click', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    show([item('1', { name: 'Bank' })], onSelect)
    await user.tab()
    await user.keyboard('{Enter}')
    expect(onSelect).toHaveBeenCalledWith('1')
  })

  it('shows a damaged item as damaged, not as garbled data (covers: AC-6)', () => {
    show([{ kind: 'damaged', id: 'x' }])
    expect(screen.getByText('Damaged item')).toBeInTheDocument()
    expect(screen.getByText(/failed its tamper check/i)).toBeInTheDocument()
  })

  it('labels the list for screen readers', () => {
    show([])
    expect(screen.getByRole('list', { name: 'Items' })).toBeInTheDocument()
  })
})
