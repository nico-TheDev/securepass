import type { OpenVaultItem, VaultItem } from './items'
import { hostOf } from './url'

/** Which part of the vault a list shows. */
export type ListView = 'all' | 'favorites' | 'trash'

/** What the list is narrowed by. */
export type ListFilter = {
  readonly view: ListView
  /** Free text, matched against name, folder, usernames, and URL hosts. */
  readonly query: string
  /** A folder name, or `null` for every folder. */
  readonly folder: string | null
}

/** The text an item is searched by. Passwords and notes are never part of it. */
const searchText = (item: OpenVaultItem): string =>
  [
    item.payload.name,
    item.payload.folder ?? '',
    item.payload.login?.username ?? '',
    ...(item.payload.login?.urls.map((entry) => hostOf(entry.url)) ?? []),
    item.payload.identity?.email ?? '',
  ]
    .join('\n')
    .toLowerCase()

/** True when every word of the query appears somewhere in the item's searchable text. */
export const matchesQuery = (item: OpenVaultItem, query: string): boolean => {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return true
  const text = searchText(item)
  return words.every((word) => text.includes(word))
}

/**
 * The items a list shows: filtered by view, folder, and query, then sorted by name.
 * Damaged items stay visible outside the trash so the user sees something is wrong.
 */
export const filterItems = (
  items: readonly VaultItem[],
  filter: ListFilter,
): readonly VaultItem[] =>
  items
    .filter((item) => {
      if (item.kind === 'damaged') {
        return filter.view === 'all' && filter.query.trim() === '' && filter.folder === null
      }
      if (item.payload.trashed !== (filter.view === 'trash')) return false
      if (filter.view === 'favorites' && !item.payload.favorite) return false
      if (filter.folder !== null && item.payload.folder !== filter.folder) return false
      return matchesQuery(item, filter.query)
    })
    .toSorted((a, b) => {
      const nameA = a.kind === 'item' ? a.payload.name : ''
      const nameB = b.kind === 'item' ? b.payload.name : ''
      return nameA.localeCompare(nameB, undefined, { sensitivity: 'base' })
    })

/** Every folder in use by an item that is not trashed, sorted. */
export const foldersOf = (items: readonly VaultItem[]): readonly string[] =>
  [
    ...new Set(
      items.flatMap((item) =>
        item.kind === 'item' && !item.payload.trashed && item.payload.folder
          ? [item.payload.folder]
          : [],
      ),
    ),
  ].toSorted((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }))
