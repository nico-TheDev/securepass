import { createApiClient, type SignInError } from '@securepass/vault'
import { browser } from 'wxt/browser'
import { env } from '../env'
import type { PopupMessage } from '../messages'

/** The typed client for the server this extension was built for. */
export const api = createApiClient(env.serverUrl)

/** Sends a message from the popup to the background and waits for its reply. */
export const send = async (message: PopupMessage): Promise<unknown> => {
  try {
    return await browser.runtime.sendMessage(message)
  } catch {
    return undefined
  }
}

/** Copies through the background, which clears the clipboard 30 seconds later. */
export const copy = async (text: string, itemId?: string): Promise<boolean> =>
  (await send({ type: 'copy', text, ...(itemId === undefined ? {} : { item_id: itemId }) })) ===
  true

/** What to tell the user after a call that proves credentials failed. */
export const signInErrorText = (error: SignInError): string => {
  switch (error.kind) {
    case 'wrong_credentials':
      return 'The email, master password, or code was not accepted.'
    case 'rate_limited':
      return `Too many failed attempts from this network. Wait ${Math.ceil(error.retryAfter / 60)} minute(s), then try again.`
    case 'network':
      return 'Could not reach the server. Check your connection and try again.'
    case 'crypto':
      return 'The server sent settings this extension will not accept, so nothing was unlocked.'
    case 'server':
      return 'The server could not finish this. Try again in a moment.'
  }
}
