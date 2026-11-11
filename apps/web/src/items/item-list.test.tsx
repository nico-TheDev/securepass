// @vitest-environment jsdom
import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ItemList } from './item-list'
import { newLoginPayload, type VaultItem } from './vault-items'

const item = (
  id: string,
  draft: { name: string; username?: string; url?: string; password?: string },
  pending = false,
): VaultItem => ({
  kind: 'item',
  id,
  revision: 1,
  pending,
  payload: newLoginPayload(
    {
      name: draft.name,
      username: draft.username ?? '',
      password: draft.password ?? '',
      url: draft.url ?? '',
      note: '',
    },
    'd',
    new Date(),
  ),
})

describe('ItemList', () => {
  it('shows the name, username, and website host of each login', () => {
    render(
      <ItemList
        items={[item('1', { name: 'Bank', username: 'me', url: 'https://www.bank.com/login' })]}
      />,
    )
    const row = screen.getByRole('listitem')
    expect(within(row).getByText('Bank')).toBeInTheDocument()
    expect(within(row).getByText('me · www.bank.com')).toBeInTheDocument()
  })

  it('never prints the password', () => {
    render(<ItemList items={[item('1', { name: 'Bank', password: 'hunter2-secret' })]} />)
    expect(screen.queryByText(/hunter2-secret/)).not.toBeInTheDocument()
  })

  it('falls back to the raw text when the website is not a valid URL', () => {
    render(<ItemList items={[item('1', { name: 'Odd', url: 'not a url' })]} />)
    expect(screen.getByText('not a url')).toBeInTheDocument()
  })

  it('says so when a login has no username or website', () => {
    render(<ItemList items={[item('1', { name: 'Bare' })]} />)
    expect(screen.getByText('No username or website')).toBeInTheDocument()
  })

  it('marks writes that have not reached the server yet', () => {
    render(<ItemList items={[item('1', { name: 'New' }, true), item('2', { name: 'Old' })]} />)
    expect(screen.getAllByText('Not synced yet')).toHaveLength(1)
  })

  it('shows a damaged item as damaged, not as garbled data (covers: AC-6)', () => {
    render(<ItemList items={[{ kind: 'damaged', id: 'x' }]} />)
    expect(screen.getByText('Damaged item')).toBeInTheDocument()
    expect(screen.getByText(/failed its tamper check/i)).toBeInTheDocument()
  })

  it('labels the list for screen readers', () => {
    render(<ItemList items={[]} />)
    expect(screen.getByRole('list', { name: 'Logins' })).toBeInTheDocument()
  })
})
