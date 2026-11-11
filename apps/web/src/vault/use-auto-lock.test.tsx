// @vitest-environment jsdom
import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useAutoLock } from './use-auto-lock'

const MINUTE = 60 * 1000

beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())

describe('useAutoLock', () => {
  it('locks after 15 minutes without activity', () => {
    const onLock = vi.fn()
    renderHook(() => useAutoLock(onLock))

    vi.advanceTimersByTime(14 * MINUTE)
    expect(onLock).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1 * MINUTE)
    expect(onLock).toHaveBeenCalledTimes(1)
  })

  it.each(['pointerdown', 'keydown', 'wheel', 'touchstart'])(
    'restarts the countdown on %s',
    (name) => {
      const onLock = vi.fn()
      renderHook(() => useAutoLock(onLock))

      vi.advanceTimersByTime(10 * MINUTE)
      window.dispatchEvent(new Event(name))
      vi.advanceTimersByTime(10 * MINUTE)
      expect(onLock).not.toHaveBeenCalled()
      vi.advanceTimersByTime(5 * MINUTE)
      expect(onLock).toHaveBeenCalledTimes(1)
    },
  )

  it('does not lock after unmount, and stops listening', () => {
    const onLock = vi.fn()
    const { unmount } = renderHook(() => useAutoLock(onLock))
    unmount()

    window.dispatchEvent(new Event('keydown'))
    vi.advanceTimersByTime(60 * MINUTE)
    expect(onLock).not.toHaveBeenCalled()
  })
})
