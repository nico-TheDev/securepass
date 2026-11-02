import type { VaultItem } from './vault-items'

const hostOf = (url: string): string => {
  try {
    return new URL(url).hostname
  } catch {
    return url
  }
}

/** The vault's items. Passwords are never printed here. */
export function ItemList({ items }: { readonly items: readonly VaultItem[] }) {
  return (
    <ul className="item-list" aria-label="Logins">
      {items.map((item) =>
        item.kind === 'damaged' ? (
          <li key={item.id} className="item-row">
            <div>
              <p className="item-name">Damaged item</p>
              <p className="item-sub">This item failed its tamper check and cannot be shown.</p>
            </div>
          </li>
        ) : (
          <li key={item.id} className="item-row">
            <div>
              <p className="item-name">{item.payload.name}</p>
              <p className="item-sub">
                {[
                  item.payload.login?.username,
                  item.payload.login?.urls[0] && hostOf(item.payload.login.urls[0].url),
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No username or website'}
              </p>
            </div>
            {item.pending ? <span className="tag">Not synced yet</span> : null}
          </li>
        ),
      )}
    </ul>
  )
}
