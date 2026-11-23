import { toBase64Url } from '@securepass/crypto'
import { browser } from 'wxt/browser'
import type { OffscreenMessage } from '../messages'
import { readSession, removeSession, writeSession } from '../session-store'

/** The alarm that clears a copied secret. */
export const CLIPBOARD_ALARM = 'clipboard-clear'

/** How long a copied secret stays on the clipboard. */
export const CLIPBOARD_CLEAR_SECONDS = 30

const digest = async (text: string): Promise<string> =>
  toBase64Url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))))

/** A service worker has no clipboard, so reads and writes go through an offscreen document. */
const ensureOffscreen = async (): Promise<void> => {
  if (await browser.offscreen.hasDocument()) return
  await browser.offscreen.createDocument({
    url: browser.runtime.getURL('/offscreen.html'),
    reasons: ['CLIPBOARD'],
    justification: 'Copy a password you chose, and clear it from the clipboard after 30 seconds.',
  })
}

const closeOffscreen = async (): Promise<void> => {
  try {
    if (await browser.offscreen.hasDocument()) await browser.offscreen.closeDocument()
  } catch {
    // Already closed.
  }
}

const toOffscreen = async (message: OffscreenMessage): Promise<unknown> => {
  await ensureOffscreen()
  return browser.runtime.sendMessage(message)
}

/**
 * Copies a secret and sets the 30 second alarm. Only a digest of the value is remembered, so the
 * alarm can tell whether the clipboard still holds it.
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
  const done = (await toOffscreen({ target: 'offscreen', type: 'clipboard-write', text })) === true
  if (!done) return false
  await writeSession({ clipboard_digest: await digest(text) })
  await browser.alarms.create(CLIPBOARD_ALARM, { delayInMinutes: CLIPBOARD_CLEAR_SECONDS / 60 })
  return true
}

/** Clears the clipboard, only if it still holds the value this extension copied. */
export const clearClipboardIfOurs = async (): Promise<void> => {
  const { clipboard_digest } = await readSession('clipboard_digest')
  if (!clipboard_digest) return
  await removeSession('clipboard_digest')
  const current = await toOffscreen({ target: 'offscreen', type: 'clipboard-read' })
  if (typeof current === 'string' && (await digest(current)) === clipboard_digest) {
    await toOffscreen({ target: 'offscreen', type: 'clipboard-write', text: '' })
  }
  await closeOffscreen()
}
