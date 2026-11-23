import { type Browser, browser } from 'wxt/browser'
import { CLIPBOARD_ALARM, clearClipboardIfOurs, copyToClipboard } from '../src/clipboard/background'
import { handleFill, handleSuggest } from '../src/fill/handlers'
import { markUsed, readDeviceId } from '../src/local-store'
import { lockIfIdle, lockNow } from '../src/lock/lock'
import {
  type ContentMessage,
  contentMessageSchema,
  type PopupMessage,
  popupMessageSchema,
} from '../src/messages'
import {
  forgetPending,
  handlePromptAnswer,
  handlePromptGet,
  handleSubmitted,
  refreshPrompts,
} from '../src/save/handlers'
import { touchActivity } from '../src/session-store'
import { dropIndex } from '../src/vault/state'
import { syncNow } from '../src/vault/sync'

const LOCK_ALARM = 'lock-check'
const SYNC_ALARM = 'sync'

/** The two repeating alarms: the 1 minute lock check and the 5 minute sync. */
const ensureAlarms = async (): Promise<void> => {
  if (!(await browser.alarms.get(LOCK_ALARM))) {
    await browser.alarms.create(LOCK_ALARM, { periodInMinutes: 1 })
  }
  if (!(await browser.alarms.get(SYNC_ALARM))) {
    await browser.alarms.create(SYNC_ALARM, { periodInMinutes: 5 })
  }
}

const fromContent = (
  message: ContentMessage,
  sender: Browser.runtime.MessageSender,
): Promise<unknown> => {
  switch (message.type) {
    case 'suggest':
      return handleSuggest(sender)
    case 'fill':
      return handleFill(message, sender)
    case 'submitted':
      return handleSubmitted(message, sender)
    case 'prompt-get':
      return handlePromptGet(sender)
    case 'prompt-answer':
      return handlePromptAnswer(message, sender)
  }
}

const fromPopup = async (message: PopupMessage): Promise<unknown> => {
  const now = Date.now()
  switch (message.type) {
    case 'unlocked':
      dropIndex()
      await touchActivity(now)
      await syncNow()
      await refreshPrompts()
      return true
    case 'lock':
      await lockNow()
      return true
    case 'sync':
      await syncNow()
      return true
    case 'activity':
      await touchActivity(now)
      return true
    case 'copy':
      await touchActivity(now)
      if (message.item_id) await markUsed(message.item_id, now)
      return copyToClipboard(message.text)
  }
}

/**
 * Routes a message by who sent it, as the browser reports it. This extension's own pages (the
 * popup) may send the popup messages. Anything else with a tab is a content script, which may
 * only send the content messages.
 */
const route = (raw: unknown, sender: Browser.runtime.MessageSender): Promise<unknown> | null => {
  if (sender.id !== browser.runtime.id) return null
  if (sender.url?.startsWith(browser.runtime.getURL('/'))) {
    const message = popupMessageSchema.safeParse(raw)
    return message.success ? fromPopup(message.data) : null
  }
  if (sender.tab === undefined) return null
  const message = contentMessageSchema.safeParse(raw)
  return message.success ? fromContent(message.data, sender) : null
}

export default defineBackground(() => {
  void ensureAlarms()
  browser.runtime.onInstalled.addListener(() => void readDeviceId())

  browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
    const reply = route(raw, sender)
    if (!reply) return false
    reply.then(sendResponse, () => sendResponse(undefined))
    return true
  })

  browser.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === LOCK_ALARM) void lockIfIdle(Date.now())
    else if (alarm.name === SYNC_ALARM) void syncNow()
    else if (alarm.name === CLIPBOARD_ALARM) void clearClipboardIfOurs()
  })

  // The system lock screen locks the vault too. Closing the browser clears session storage.
  browser.idle.onStateChanged.addListener((state) => {
    if (state === 'locked') void lockNow()
  })

  browser.tabs.onRemoved.addListener((tabId) => void forgetPending(tabId))
  self.addEventListener('online', () => void syncNow())
})
