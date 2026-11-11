// @vitest-environment jsdom
import type { Cache } from '@securepass/shared/cache'
import type { SyncError } from '@securepass/shared/sync'
import { syncVault as syncOnce } from '@securepass/vault'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from 'vitest'
import { useSync } from './use-sync'

vi.mock('@securepass/vault', () => ({ syncVault: vi.fn() }))

const cache = {} as Cache
const vaultKey = new Uint8Array(32)
const synced = () => ({ ok: true as const, value: undefined })
const failed = (error: SyncError) => ({ ok: false as const, error })

let onSynced: Mock<() => void>
let onRevoked: Mock<() => void>
const setup = () => renderHook(() => useSync({ cache, vaultKey, onSynced, onRevoked }))

beforeEach(() => {
  onSynced = vi.fn<() => void>()
  onRevoked = vi.fn<() => void>()
  vi.mocked(syncOnce).mockResolvedValue(synced() as never)
})
afterEach(() => {
  vi.useRealTimers()
  vi.resetAllMocks()
})

describe('useSync', () => {
  it('syncs once at the start and reports synced (covers: AC-8)', async () => {
    const { result } = setup()

    await waitFor(() => expect(result.current.status.state).toBe('synced'))
    expect(syncOnce).toHaveBeenCalledTimes(1)
    expect(onSynced).toHaveBeenCalledTimes(1)
  })

  it('syncs again every 5 minutes while mounted (covers: AC-8)', async () => {
    vi.useFakeTimers()
    setup()
    await act(async () => {})
    expect(syncOnce).toHaveBeenCalledTimes(1)

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 1000)
    })
    expect(syncOnce).toHaveBeenCalledTimes(2)
  })

  it('syncs when the browser comes back online', async () => {
    const { result } = setup()
    await waitFor(() => expect(result.current.status.state).toBe('synced'))

    await act(async () => {
      window.dispatchEvent(new Event('online'))
    })
    expect(syncOnce).toHaveBeenCalledTimes(2)
  })

  it('stops the timer and the online listener on unmount', async () => {
    vi.useFakeTimers()
    const { unmount } = setup()
    await act(async () => {})
    unmount()

    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(10 * 60 * 1000)
    expect(syncOnce).toHaveBeenCalledTimes(1)
  })

  it('reports offline on a network failure and does not reload the list (covers: AC-10)', async () => {
    vi.mocked(syncOnce).mockResolvedValue(failed({ kind: 'network' }) as never)
    const { result } = setup()

    await waitFor(() => expect(result.current.status.state).toBe('offline'))
    expect(onSynced).not.toHaveBeenCalled()
  })

  it('calls onRevoked and stops when the device was revoked (covers: AC-22)', async () => {
    vi.mocked(syncOnce).mockResolvedValue(
      failed({ kind: 'unauthorized', code: 'revoked' }) as never,
    )
    setup()

    await waitFor(() => expect(onRevoked).toHaveBeenCalledTimes(1))
    expect(onSynced).not.toHaveBeenCalled()
  })

  it('asks for attention, without revoking, when the session merely expired (covers: AC-22)', async () => {
    vi.mocked(syncOnce).mockResolvedValue(
      failed({ kind: 'unauthorized', code: 'expired' }) as never,
    )
    const { result } = setup()

    await waitFor(() => expect(result.current.status.state).toBe('attention'))
    expect(onRevoked).not.toHaveBeenCalled()
  })

  it('never overlaps rounds and folds calls during a round into one more round', async () => {
    let release: () => void = () => {}
    vi.mocked(syncOnce).mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve(synced() as never)
        }),
    )
    const { result } = setup()
    await waitFor(() => expect(result.current.status.state).toBe('syncing'))

    await act(async () => {
      void result.current.syncNow()
      void result.current.syncNow()
    })
    expect(syncOnce).toHaveBeenCalledTimes(1)

    await act(async () => release())
    await waitFor(() => expect(syncOnce).toHaveBeenCalledTimes(2))
  })
})
