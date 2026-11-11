// @vitest-environment jsdom
import { clearCache, openCache, writeMeta } from '@securepass/shared/cache'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { App } from './app'

// The app opens the default database, and earlier tests may still hold it open, so empty it instead of deleting it.
beforeEach(async () => {
  const cache = await openCache()
  await clearCache(cache)
  cache.close()
})

describe('App', () => {
  it('shows Loading while the cache opens', () => {
    render(<App />)
    expect(screen.getByRole('status')).toHaveTextContent('Loading…')
  })

  it('opens setup on a device with no local copy (covers: AC-1)', async () => {
    render(<App />)
    expect(await screen.findByRole('heading', { name: 'Create your vault' })).toBeInTheDocument()
  })

  it('opens unlock, not setup, when the device already has an account (covers: AC-10)', async () => {
    const cache = await openCache()
    await writeMeta(cache, {
      account_id: 'a',
      email: 'me@example.com',
      kdf: { alg: 'argon2id', m: 65536, t: 3, p: 1 },
      kdf_salt: 'c2FsdA',
      wrapped_vault_key: 'w',
      last_revision: 0,
      token: 't',
      device_id: 'd',
      seen_seq: {},
    })
    cache.close()

    render(<App />)

    expect(await screen.findByRole('heading', { name: 'Unlock your vault' })).toBeInTheDocument()
    expect(screen.getByText('me@example.com')).toBeInTheDocument()
  })

  it('moves between setup and sign in', async () => {
    const user = userEvent.setup()
    render(<App />)
    await user.click(await screen.findByRole('button', { name: 'I already have an account' }))
    expect(screen.getByRole('heading', { name: 'Sign in to your vault' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create a new vault' }))
    expect(screen.getByRole('heading', { name: 'Create your vault' })).toBeInTheDocument()
  })
})
