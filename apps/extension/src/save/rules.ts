import { type OpenVaultItem, siteOf } from '@securepass/vault'

/** How long captured credentials wait for your answer before they are dropped. */
export const PENDING_TTL_MS = 2 * 60 * 1000

/** What a page submitted, after the background has checked the page. */
export type Submitted = {
  readonly origin: string
  readonly username: string
  /** The password to keep: the new one on a change password form. */
  readonly password: string
  /** The old password typed on a change password form. */
  readonly previous?: string | undefined
}

/** What the extension offers after a submit. Nothing is written without a confirm. */
export type SaveDecision =
  | { readonly kind: 'none' }
  | { readonly kind: 'save' }
  | { readonly kind: 'update'; readonly itemId: string }
  | { readonly kind: 'choose'; readonly itemIds: readonly string[] }

const sameUsername = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/** Logins, not in the trash, saved for the same registrable domain as the page. */
export const loginsForSite = (
  items: readonly OpenVaultItem[],
  origin: string,
): readonly OpenVaultItem[] => {
  const site = siteOf(origin)
  if (!site) return []
  return items.filter(
    (item) =>
      item.payload.type === 'login' &&
      !item.payload.trashed &&
      item.payload.login?.urls.some((saved) => siteOf(saved.url) === site),
  )
}

/**
 * Decides what to offer after a login form was submitted:
 * no login for this site and username → save a new one; one with a different password → update it;
 * several → ask which one. A password the vault already holds for that login offers nothing.
 * A form with no username (many change password forms) is matched by the old password, then by
 * being the only login for the site.
 */
export const decideSave = (items: readonly OpenVaultItem[], submitted: Submitted): SaveDecision => {
  if (submitted.password === '') return { kind: 'none' }
  const site = loginsForSite(items, submitted.origin)
  const passwordOf = (item: OpenVaultItem): string => item.payload.login?.password ?? ''
  const named =
    submitted.username.trim() === ''
      ? site
      : site.filter((item) => sameUsername(item.payload.login?.username ?? '', submitted.username))

  if (named.length === 0) return { kind: 'save' }
  if (named.some((item) => passwordOf(item) === submitted.password)) return { kind: 'none' }

  const byOldPassword =
    submitted.previous === undefined
      ? []
      : named.filter((item) => passwordOf(item) === submitted.previous)
  const [onlyOld] = byOldPassword
  if (byOldPassword.length === 1 && onlyOld) return { kind: 'update', itemId: onlyOld.id }

  const [only] = named
  if (named.length === 1 && only) return { kind: 'update', itemId: only.id }
  return { kind: 'choose', itemIds: named.map((item) => item.id) }
}

/** True once captured credentials are too old to offer. */
export const isExpired = (capturedAt: number, now: number): boolean =>
  now - capturedAt > PENDING_TTL_MS
