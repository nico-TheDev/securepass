import {
  createItem,
  draftOf,
  emptyDraft,
  hostOf,
  normalizeUrl,
  type OpenVaultItem,
  updateItem,
} from '@securepass/vault'
import { type Browser, browser } from 'wxt/browser'
import { toSuggestion } from '../fill/rules'
import type { ContentMessage, PromptAnswerReply, PromptPush, PromptView } from '../messages'
import { checkSender } from '../page-facts'
import { type PendingSave, readSession, touchActivity, writeSession } from '../session-store'
import { dropIndex, loadIndex, readUnlocked } from '../vault/state'
import { syncNow } from '../vault/sync'
import { decideSave, isExpired, type SaveDecision } from './rules'

const readPending = async (): Promise<Readonly<Record<string, PendingSave>>> =>
  (await readSession('pending_saves')).pending_saves ?? {}

const writePending = (tabId: number, pending: PendingSave | null): Promise<void> =>
  readPending().then((all) => {
    const { [String(tabId)]: _old, ...rest } = all
    return writeSession({ pending_saves: pending ? { ...rest, [String(tabId)]: pending } : rest })
  })

/** Drops whatever was captured for a tab, when the tab closes or you answer the prompt. */
export const forgetPending = (tabId: number): Promise<void> => writePending(tabId, null)

const decide = (items: readonly OpenVaultItem[], pending: PendingSave): SaveDecision =>
  decideSave(items, {
    origin: pending.origin,
    username: pending.username,
    password: pending.password,
    previous: pending.previous,
  })

/** What the bar should show for captured credentials, or `null` when there is nothing to offer. */
const viewFor = (
  items: readonly OpenVaultItem[] | null,
  pending: PendingSave,
): PromptView | null => {
  const host = hostOf(pending.origin)
  if (!items) return { kind: 'unlock', host }
  const decision = decide(items, pending)
  const find = (id: string) => items.find((item) => item.id === id)
  if (decision.kind === 'save') return { kind: 'save', host, username: pending.username }
  if (decision.kind === 'update') {
    const item = find(decision.itemId)
    return item
      ? { kind: 'update', host, username: pending.username, item: toSuggestion(item) }
      : null
  }
  if (decision.kind === 'choose') {
    const choices = decision.itemIds.flatMap((id) => {
      const item = find(id)
      return item ? [toSuggestion(item)] : []
    })
    return { kind: 'choose', host, username: pending.username, items: choices }
  }
  return null
}

const push = async (tabId: number, message: PromptPush): Promise<void> => {
  try {
    await browser.tabs.sendMessage(tabId, message, { frameId: 0 })
  } catch {
    // The page is navigating. Its next content script asks with `prompt-get`.
  }
}

/**
 * `submitted`: a page reported a login submit. Nothing is ever saved from a page that fails
 * rules 4 and 5, and nothing is written here at all: the credentials wait in memory for a confirm.
 */
export const handleSubmitted = async (
  message: Extract<ContentMessage, { type: 'submitted' }>,
  sender: Browser.runtime.MessageSender,
): Promise<void> => {
  const page = await checkSender(sender)
  if (!page.ok) return
  const password = message.password_new ?? message.password
  const pending: PendingSave = {
    origin: page.value.origin,
    url: normalizeUrl(page.value.url) ?? page.value.origin,
    username: message.username.trim(),
    password,
    ...(message.password_new !== undefined && message.password_new !== message.password
      ? { previous: message.password }
      : {}),
    captured_at: Date.now(),
  }
  const view = viewFor(await loadIndex(), pending)
  if (!view) {
    await forgetPending(page.value.tabId)
    return
  }
  await writePending(page.value.tabId, pending)
  await push(page.value.tabId, { type: 'prompt-show', prompt: view })
}

const livePending = async (tabId: number): Promise<PendingSave | null> => {
  const pending = (await readPending())[String(tabId)]
  if (!pending) return null
  if (!isExpired(pending.captured_at, Date.now())) return pending
  await forgetPending(tabId)
  return null
}

const topTab = (sender: Browser.runtime.MessageSender): number | null =>
  sender.tab?.id !== undefined && sender.frameId === 0 ? sender.tab.id : null

/** `prompt-get`: the top frame of a freshly loaded page asks whether a prompt waits for its tab. */
export const handlePromptGet = async (
  sender: Browser.runtime.MessageSender,
): Promise<PromptView | null> => {
  const tabId = topTab(sender)
  if (tabId === null) return null
  const pending = await livePending(tabId)
  return pending ? viewFor(await loadIndex(), pending) : null
}

/**
 * `prompt-answer`: you clicked Save, Update, or Not now. The decision is made again here from
 * the vault, so the page cannot steer a write to an item the rules would not offer.
 */
export const handlePromptAnswer = async (
  message: Extract<ContentMessage, { type: 'prompt-answer' }>,
  sender: Browser.runtime.MessageSender,
): Promise<PromptAnswerReply> => {
  const tabId = topTab(sender)
  if (tabId === null) return { status: 'failed' }
  if (message.action === 'dismiss') {
    await forgetPending(tabId)
    return { status: 'dismissed' }
  }
  const pending = await livePending(tabId)
  if (!pending) return { status: 'failed' }
  const [unlocked, items] = await Promise.all([readUnlocked(), loadIndex()])
  if (!unlocked || !items) return { status: 'locked' }
  const decision = decide(items, pending)

  if (message.action === 'save' && decision.kind === 'save') {
    const saved = await createItem(unlocked.cache, unlocked.vaultKey, {
      ...emptyDraft('login'),
      // The name defaults to the page host.
      name: hostOf(pending.origin),
      username: pending.username,
      password: pending.password,
      urls: [{ url: pending.url, match: 'domain' }],
    })
    if (!saved.ok) return { status: 'failed' }
  } else if (message.action === 'update') {
    const allowed =
      decision.kind === 'update'
        ? [decision.itemId]
        : decision.kind === 'choose'
          ? decision.itemIds
          : []
    const item = items.find((entry) => entry.id === message.item_id)
    if (!item || !allowed.includes(item.id)) return { status: 'failed' }
    // The old password goes to the item's password history.
    const updated = await updateItem(unlocked.cache, unlocked.vaultKey, item.id, {
      ...draftOf(item.payload),
      password: pending.password,
    })
    if (!updated.ok) return { status: 'failed' }
  } else {
    return { status: 'failed' }
  }

  await forgetPending(tabId)
  dropIndex()
  await touchActivity(Date.now())
  void syncNow()
  return { status: 'saved' }
}

/** After an unlock: every tab waiting on "Unlock to save" gets its real prompt. */
export const refreshPrompts = async (): Promise<void> => {
  const items = await loadIndex()
  const now = Date.now()
  await Promise.all(
    Object.entries(await readPending()).map(async ([tab, pending]) => {
      const tabId = Number(tab)
      if (isExpired(pending.captured_at, now)) return forgetPending(tabId)
      const view = viewFor(items, pending)
      if (!view) {
        await forgetPending(tabId)
        return push(tabId, { type: 'prompt-hide' })
      }
      return push(tabId, { type: 'prompt-show', prompt: view })
    }),
  )
}
