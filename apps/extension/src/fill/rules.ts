import { err, ok, type Result } from '@securepass/shared'
import { matchSavedUrl, type OpenVaultItem, type UrlMatchMode } from '@securepass/vault'
import type { Suggestion } from '../messages'

/** Most suggestions shown for one page. */
export const MAX_SUGGESTIONS = 10

/** What the browser reports about the frame that sent a message. Nothing here comes from the page. */
export type PageFacts = {
  /** `sender.origin`. */
  readonly senderOrigin: string | undefined
  /** The URL of the tab's top page. */
  readonly topUrl: string | undefined
  /** The frame's URL as `webNavigation.getFrame` reports it. */
  readonly frameUrl: string | undefined
}

/** Why a page may not receive suggestions, fills, or save prompts. */
export type PageRefusal = 'insecure' | 'cross_origin' | 'unknown_page'

const originOf = (url: string | undefined): string | null => {
  if (!url) return null
  try {
    return new URL(url).origin
  } catch {
    return null
  }
}

/**
 * Fill rules 4 and 5: the frame is `https`, has the same origin as the tab's top page, and the
 * browser confirms the frame really shows that origin.
 * @returns The checked page origin.
 */
export const checkPage = (facts: PageFacts): Result<string, PageRefusal> => {
  const origin = originOf(facts.senderOrigin)
  // A sandboxed frame reports the origin "null", which is not a URL.
  if (!origin || origin === 'null' || origin !== facts.senderOrigin) return err('unknown_page')
  if (!origin.startsWith('https://')) return err('insecure')
  const top = originOf(facts.topUrl)
  const frame = originOf(facts.frameUrl)
  if (!top || !frame) return err('unknown_page')
  if (top !== origin || frame !== origin) return err('cross_origin')
  return ok(origin)
}

/** A login that matches a page, and how. */
export type LoginMatch = { readonly item: OpenVaultItem; readonly mode: UrlMatchMode }

/** Fill rule 6 for one item: the best match among its saved URLs, or `null`. */
export const matchItem = (item: OpenVaultItem, pageOrigin: string): UrlMatchMode | null => {
  if (item.payload.type !== 'login' || item.payload.trashed || !item.payload.login) return null
  const modes = item.payload.login.urls.map((saved) => matchSavedUrl(pageOrigin, saved))
  return modes.includes('host') ? 'host' : modes.includes('domain') ? 'domain' : null
}

/**
 * Every login that matches the page, ordered: exact host first, then most recently used, then name.
 * @param lastUsed - When each item was last used here, by item id.
 */
export const matchLogins = (
  items: readonly OpenVaultItem[],
  pageOrigin: string,
  lastUsed: Readonly<Record<string, number>>,
): readonly LoginMatch[] =>
  items
    .flatMap((item): LoginMatch[] => {
      const mode = matchItem(item, pageOrigin)
      return mode ? [{ item, mode }] : []
    })
    .toSorted(
      (a, b) =>
        Number(b.mode === 'host') - Number(a.mode === 'host') ||
        (lastUsed[b.item.id] ?? 0) - (lastUsed[a.item.id] ?? 0) ||
        a.item.payload.name.localeCompare(b.item.payload.name, undefined, { sensitivity: 'base' }),
    )

/** The row a content script may see for an item: name and username, never the password. */
export const toSuggestion = (item: OpenVaultItem): Suggestion => ({
  item_id: item.id,
  name: item.payload.name,
  username: item.payload.login?.username ?? '',
})
