import type { Browser } from 'wxt/browser'
import { markUsed, readLastUsed } from '../local-store'
import type { ContentMessage, FillReply, SuggestReply } from '../messages'
import { checkSender } from '../page-facts'
import { touchActivity } from '../session-store'
import { loadIndex } from '../vault/state'
import { MAX_SUGGESTIONS, matchItem, matchLogins, toSuggestion } from './rules'

/**
 * `suggest`: up to 10 logins that match the sender's page, as name and username only.
 * The page must pass rules 4 and 5, and the vault must be unlocked.
 */
export const handleSuggest = async (
  sender: Browser.runtime.MessageSender,
): Promise<SuggestReply> => {
  const page = await checkSender(sender)
  if (!page.ok) return { status: 'blocked' }
  const items = await loadIndex()
  if (!items) return { status: 'locked' }
  const matches = matchLogins(items, page.value.origin, await readLastUsed())
    .slice(0, MAX_SUGGESTIONS)
    .map((match) => toSuggestion(match.item))
  await touchActivity(Date.now())
  return { status: 'ok', matches }
}

/**
 * `fill`: hands back the one clicked login, only when the vault is unlocked (rule 3), the page is
 * `https` (rule 4) and same origin as the top page (rule 5), and the item matches the page (rule 6).
 * Rules 1 and 2 (a real click, visible fields) are checked by the content script.
 */
export const handleFill = async (
  message: Extract<ContentMessage, { type: 'fill' }>,
  sender: Browser.runtime.MessageSender,
): Promise<FillReply> => {
  const page = await checkSender(sender)
  if (!page.ok) return { status: 'refused' }
  const items = await loadIndex()
  const item = items?.find((entry) => entry.id === message.item_id)
  if (!item?.payload.login || !matchItem(item, page.value.origin)) return { status: 'refused' }
  const now = Date.now()
  await Promise.all([markUsed(item.id, now), touchActivity(now)])
  return {
    status: 'ok',
    username: item.payload.login.username,
    password: item.payload.login.password,
    field_ids: message.field_ids,
  }
}
