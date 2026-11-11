import { hostOf, type VaultItem } from '@securepass/vault'

const TYPE_LABEL = { login: 'Login', note: 'Note', identity: 'Identity' } as const

/** The one line under an item's name. Passwords and note text are never printed here. */
const subtitleOf = (item: Extract<VaultItem, { kind: 'item' }>): string => {
  const { payload } = item
  if (payload.type === 'login') {
    const url = payload.login?.urls[0]
    return (
      [payload.login?.username, url ? hostOf(url.url) : undefined].filter(Boolean).join(' · ') ||
      'No username or website'
    )
  }
  if (payload.type === 'identity') {
    return (
      [payload.identity?.first, payload.identity?.last].filter(Boolean).join(' ') ||
      payload.identity?.email ||
      'Identity'
    )
  }
  return 'Secure note'
}

type Props = {
  readonly items: readonly VaultItem[]
  readonly selectedId?: string | undefined
  readonly onSelect: (id: string) => void
  readonly label?: string
}

/** The vault's items. Each row opens the item. */
export function ItemList({ items, selectedId, onSelect, label = 'Items' }: Props) {
  return (
    <ul className="item-list" aria-label={label}>
      {items.map((item) =>
        item.kind === 'damaged' ? (
          <li key={item.id} className="item-row">
            <div>
              <p className="item-name">Damaged item</p>
              <p className="item-sub">This item failed its tamper check and cannot be shown.</p>
            </div>
          </li>
        ) : (
          <li key={item.id}>
            <button
              type="button"
              className="item-row item-button"
              aria-current={item.id === selectedId ? 'true' : undefined}
              onClick={() => onSelect(item.id)}
            >
              <span className="item-text">
                <span className="item-name">
                  {item.payload.favorite ? (
                    <span className="star" role="img" aria-label="Favorite">
                      ★{' '}
                    </span>
                  ) : null}
                  {item.payload.name}
                </span>
                <span className="item-sub">{subtitleOf(item)}</span>
              </span>
              <span className="item-tags">
                {item.rolledBack || (item.payload.conflict_copies?.length ?? 0) > 0 ? (
                  <span className="tag tag-warn">Needs a look</span>
                ) : null}
                {item.pending ? <span className="tag">Not synced yet</span> : null}
                <span className="tag">{TYPE_LABEL[item.payload.type]}</span>
              </span>
            </button>
          </li>
        ),
      )}
    </ul>
  )
}
