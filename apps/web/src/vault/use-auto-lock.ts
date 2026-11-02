import { useEffect } from 'react'

const FIFTEEN_MINUTES = 15 * 60 * 1000
const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'wheel', 'touchstart'] as const

/**
 * Locks the vault after 15 minutes without activity in this tab.
 * @param onLock - Called once when the idle time runs out.
 */
export const useAutoLock = (onLock: () => void): void => {
  useEffect(() => {
    let timer = setTimeout(onLock, FIFTEEN_MINUTES)
    const reset = () => {
      clearTimeout(timer)
      timer = setTimeout(onLock, FIFTEEN_MINUTES)
    }
    for (const name of ACTIVITY_EVENTS) window.addEventListener(name, reset, { passive: true })
    return () => {
      clearTimeout(timer)
      for (const name of ACTIVITY_EVENTS) window.removeEventListener(name, reset)
    }
  }, [onLock])
}
