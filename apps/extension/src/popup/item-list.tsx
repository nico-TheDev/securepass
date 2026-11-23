import { filterItems, hostOf, type OpenVaultItem, type VaultItem } from '@securepass/vault'
import { useMemo, useState } from 'react'
import { matchItem } from '../fill/rules'
import { copy } from './background'
import { TextField } from './fields'

type Props = {
  readonly items: readonly VaultItem[] | undefined
  /** The origin of the tab the popup was opened on, when it is an `https` page. */
  readonly pageOrigin: string | null
}

const subtitle = (item: OpenVaultItem): string => {
  if (item.payload.type === 'login') {
    const host = item.payload.login?.urls[0] ? hostOf(item.payload.login.urls[0].url) : ''
    return [item.payload.login?.username, host].filter(Boolean).join(' · ') || 'Login'
  }
  return item.payload.type === 'note' ? 'Secure note' : 'Identity'
}

/** Search and the item list. Secrets are never printed; they are copied by a deliberate click. */
export function ItemList({ items, pageOrigin }: Props) {
  const [query, setQuery] = useState('')
  const [copied, setCopied] = useState('')

  const listed = useMemo(() => {
    const shown = filterItems(items ?? [], { view: 'all', query, folder: null })
    const here = (item: VaultItem): boolean =>
      pageOrigin !== null && item.kind === 'item' && matchItem(item, pageOrigin) !== null
    // Logins for the page you are on come first.
    return [...shown.filter(here), ...shown.filter((item) => !here(item))].map((item) => ({
      item,
      here: here(item),
    }))
  }, [items, query, pageOrigin])

  const copyValue = async (text: string, what: string, itemId: string) => {
    const done = await copy(text, itemId)
    setCopied(done ? `${what} copied. It will be cleared in 30 seconds.` : 'The copy did not work.')
  }

  return (
    <section aria-label="Items">
      <TextField
        label="Search"
        type="search"
        value={query}
        onChange={setQuery}
        autoComplete="off"
        autoFocus
      />
      <p className="status" role="status">
        {copied}
      </p>
      {items === undefined ? (
        <p className="muted">Opening your vault…</p>
      ) : listed.length === 0 ? (
        <p className="muted">
          {items.length === 0
            ? 'Your vault is empty. Add logins in the web vault, or save one when you sign in to a site.'
            : 'No item matches that search.'}
        </p>
      ) : (
        <ul className="items">
          {listed.map(({ item, here }) =>
            item.kind === 'damaged' ? (
              <li key={item.id} className="item">
                <div className="item-text">
                  <strong>Damaged item</strong>
                  <span>It failed its tamper check and was not opened.</span>
                </div>
              </li>
            ) : (
              <li key={item.id} className="item">
                <div className="item-text">
                  <strong>{item.payload.name}</strong>
                  <span>
                    {subtitle(item)}
                    {here ? ' · This site' : ''}
                    {item.pending ? ' · Not synced yet' : ''}
                  </span>
                </div>
                {item.payload.login ? (
                  <div className="item-actions">
                    <button
                      className="btn btn-small"
                      type="button"
                      disabled={item.payload.login.username === ''}
                      onClick={() =>
                        void copyValue(item.payload.login?.username ?? '', 'Username', item.id)
                      }
                    >
                      Copy name
                      <span className="visually-hidden"> for {item.payload.name}</span>
                    </button>
                    <button
                      className="btn btn-small"
                      type="button"
                      onClick={() =>
                        void copyValue(item.payload.login?.password ?? '', 'Password', item.id)
                      }
                    >
                      Copy password
                      <span className="visually-hidden"> for {item.payload.name}</span>
                    </button>
                  </div>
                ) : item.payload.type === 'note' ? (
                  <div className="item-actions">
                    <button
                      className="btn btn-small"
                      type="button"
                      onClick={() => void copyValue(item.payload.note, 'Note', item.id)}
                    >
                      Copy note
                      <span className="visually-hidden"> {item.payload.name}</span>
                    </button>
                  </div>
                ) : null}
              </li>
            ),
          )}
        </ul>
      )}
    </section>
  )
}
