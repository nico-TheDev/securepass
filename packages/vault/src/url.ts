import { parse } from 'tldts'

/** How a saved URL is compared with a page: by registrable domain, or by exact host. */
export type UrlMatchMode = 'domain' | 'host'

/** A URL saved on a login. */
export type SavedUrl = { readonly url: string; readonly match: UrlMatchMode }

const withScheme = (text: string): string =>
  /^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`

const parseUrl = (text: string): URL | null => {
  try {
    const url = new URL(withScheme(text.trim()))
    return url.hostname === '' ? null : url
  } catch {
    return null
  }
}

/**
 * Normalizes a URL for saving: lowercase scheme and host, default ports dropped, path kept,
 * query and fragment dropped. A URL typed without a scheme gets `https://`.
 * @returns The normalized URL, or `null` when the text is not a URL.
 */
export const normalizeUrl = (text: string): string | null => {
  if (text.trim() === '') return null
  const url = parseUrl(text)
  if (!url || (url.protocol !== 'https:' && url.protocol !== 'http:')) return null
  const path = url.pathname === '/' ? '' : url.pathname
  return `${url.protocol}//${url.host}${path}`
}

/** The host of a URL for display, or the text itself when it is not a URL. */
export const hostOf = (text: string): string => parseUrl(text)?.hostname ?? text

/**
 * The registrable domain of a URL using the Public Suffix List with private suffixes on, so
 * `alice.github.io` and `bob.github.io` are different sites. IP addresses and `localhost` have no
 * registrable domain; for those the host with its port is returned.
 */
export const siteOf = (text: string): string | null => {
  const url = parseUrl(text)
  if (!url) return null
  const info = parse(url.hostname, { allowPrivateDomains: true })
  return info.isIp || !info.domain ? url.host : info.domain
}

/**
 * Fill rule 6: does a saved URL match the page origin?
 * `domain` compares registrable domains; `host` compares the exact host. IP addresses and
 * `localhost` only ever match by exact host and port. A saved URL with an explicit port matches
 * only that port.
 * @returns `host` for an exact host match, `domain` for a registrable domain match, else `null`.
 */
export const matchSavedUrl = (pageOrigin: string, saved: SavedUrl): UrlMatchMode | null => {
  const page = parseUrl(pageOrigin)
  const target = parseUrl(saved.url)
  if (!page || !target) return null
  const pageInfo = parse(page.hostname, { allowPrivateDomains: true })
  const targetInfo = parse(target.hostname, { allowPrivateDomains: true })
  const sameHost = page.hostname === target.hostname

  const hostOnly = pageInfo.isIp || targetInfo.isIp || !pageInfo.domain || !targetInfo.domain
  if (hostOnly) return sameHost && page.port === target.port ? 'host' : null
  if (target.port !== '' && page.port !== target.port) return null
  if (sameHost) return 'host'
  if (saved.match === 'host') return null
  return pageInfo.domain === targetInfo.domain ? 'domain' : null
}
