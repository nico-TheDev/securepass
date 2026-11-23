import { browser } from 'wxt/browser'

/** The name this extension shows in the device list. */
export const DEVICE_NAME = 'Browser extension'

/**
 * This extension's device id (UUID v4), made on first use and kept in `chrome.storage.local`.
 * It identifies the extension's own device session and binds the PIN wrap to this install.
 */
export const readDeviceId = async (): Promise<string> => {
  const { device_id } = await browser.storage.local.get('device_id')
  if (typeof device_id === 'string' && device_id !== '') return device_id
  const made = crypto.randomUUID()
  await browser.storage.local.set({ device_id: made })
  return made
}

/** When each item was last filled or copied here, in milliseconds, by item id. */
export const readLastUsed = async (): Promise<Readonly<Record<string, number>>> => {
  const { last_used } = await browser.storage.local.get('last_used')
  return last_used && typeof last_used === 'object' ? (last_used as Record<string, number>) : {}
}

/** Records that an item was just used, so it sorts first among equal matches next time. */
export const markUsed = async (itemId: string, now: number): Promise<void> => {
  await browser.storage.local.set({ last_used: { ...(await readLastUsed()), [itemId]: now } })
}

/** Forgets the usage times, for a device that was signed out. The device id is kept. */
export const clearLastUsed = (): Promise<void> => browser.storage.local.remove('last_used')
