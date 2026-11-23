import { browser } from 'wxt/browser'
import { readClipboard, writeClipboard } from '../../src/clipboard/offscreen'
import { offscreenMessageSchema } from '../../src/messages'

// The offscreen document does one job: clipboard reads and writes for the background.
browser.runtime.onMessage.addListener((raw, sender, sendResponse) => {
  if (sender.id !== browser.runtime.id || sender.tab !== undefined) return false
  const message = offscreenMessageSchema.safeParse(raw)
  if (!message.success) return false
  sendResponse(
    message.data.type === 'clipboard-write'
      ? writeClipboard(document, message.data.text)
      : readClipboard(document),
  )
  return false
})
