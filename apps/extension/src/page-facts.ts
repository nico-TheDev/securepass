import type { Result } from '@securepass/shared'
import { type Browser, browser } from 'wxt/browser'
import { checkPage, type PageRefusal } from './fill/rules'

/** A message sender that passed fill rules 4 and 5. */
export type CheckedPage = {
  readonly origin: string
  readonly tabId: number
  readonly frameId: number
  /** The frame's URL, as the browser reports it. */
  readonly url: string
}

const frameUrl = async (tabId: number, frameId: number): Promise<string | undefined> => {
  try {
    return (await browser.webNavigation.getFrame({ tabId, frameId }))?.url
  } catch {
    return undefined
  }
}

/**
 * Applies fill rules 4 and 5 to a message sender. Everything is read from what the browser
 * reports (`sender` and `webNavigation.getFrame`), never from the message payload.
 */
export const checkSender = async (
  sender: Browser.runtime.MessageSender,
): Promise<Result<CheckedPage, PageRefusal>> => {
  const tabId = sender.tab?.id
  const frameId = sender.frameId
  if (tabId === undefined || frameId === undefined) return { ok: false, error: 'unknown_page' }
  const confirmed = await frameUrl(tabId, frameId)
  const topUrl = frameId === 0 ? confirmed : (sender.tab?.url ?? (await frameUrl(tabId, 0)))
  const page = checkPage({ senderOrigin: sender.origin, topUrl, frameUrl: confirmed })
  if (!page.ok) return page
  return { ok: true, value: { origin: page.value, tabId, frameId, url: confirmed ?? page.value } }
}
