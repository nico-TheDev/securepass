import { type Cache, type CacheMeta, readMeta } from '@securepass/shared/cache'
import {
  createItem,
  dismissRollbackFlag,
  filterItems,
  foldersOf,
  type ItemDraft,
  type ListFilter,
  loadVaultItems,
  type OpenVaultItem,
  patchItem,
  type SaveError,
  updateItem,
  type VaultItem,
} from '@securepass/vault'
import { useCallback, useEffect, useId, useMemo, useState } from 'react'
import { DevicesScreen } from '../account/devices-screen'
import { SettingsScreen } from '../account/settings-screen'
import { api } from '../auth/api'
import { ReauthDialog } from '../auth/reauth-dialog'
import type { Session } from '../auth/vault-session'
import { ItemDetail } from '../items/item-detail'
import { ItemFormDialog, type ItemFormTarget } from '../items/item-form-dialog'
import { ItemList } from '../items/item-list'
import { type SyncStatus, useSync } from '../sync/use-sync'
import { GeneratorScreen } from '../tools/generator-screen'
import { ImportScreen } from '../tools/import-screen'
import { Brand } from '../ui/brand'
import { actionErrorText } from '../ui/errors'
import { TotpDialog } from '../ui/totp-dialog'
import { useAutoLock } from './use-auto-lock'

type Props = {
  readonly cache: Cache
  readonly session: Session
  readonly onLock: () => void
  readonly onRevoked: () => void
  /** Called when this device's token or key settings change (sign in again, password change). */
  readonly onSessionChange?: (session: Session) => void
  readonly onRecover?: () => void
}

type View = 'items' | 'generator' | 'import' | 'devices' | 'settings'
const VIEWS: readonly (readonly [View, string])[] = [
  ['items', 'Vault'],
  ['generator', 'Generator'],
  ['import', 'Import'],
  ['devices', 'Devices'],
  ['settings', 'Settings'],
]

/** A sensitive action waiting for a fresh authenticator code. */
type TotpAction =
  | { readonly kind: 'delete'; readonly item: OpenVaultItem }
  | { readonly kind: 'empty-trash' }

const sessionExpired = (status: SyncStatus): boolean =>
  status.state === 'attention' && status.reason.kind === 'unauthorized'

const statusText = (status: SyncStatus): string => {
  switch (status.state) {
    case 'idle':
      return 'Not synced yet'
    case 'syncing':
      return 'Syncing…'
    case 'synced':
      return `Synced at ${new Date(status.at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
    case 'offline':
      return 'Offline. Changes are saved on this device.'
    case 'attention':
      return status.reason.kind === 'unauthorized'
        ? 'Session expired. Sign in again to sync. Your changes are kept.'
        : 'Sync needs attention. Your changes are kept.'
  }
}

const VIEW_TITLE = { all: 'All items', favorites: 'Favorites', trash: 'Trash' } as const

/** The unlocked vault: navigation, the item list with search and filters, and the tools. */
export function VaultScreen({
  cache,
  session,
  onLock,
  onRevoked,
  onSessionChange,
  onRecover,
}: Props) {
  const [view, setView] = useState<View>('items')
  const [items, setItems] = useState<readonly VaultItem[] | undefined>()
  const [filter, setFilter] = useState<ListFilter>({ view: 'all', query: '', folder: null })
  const [selectedId, setSelectedId] = useState<string | undefined>()
  const [formTarget, setFormTarget] = useState<ItemFormTarget | undefined>()
  const [totpAction, setTotpAction] = useState<TotpAction | undefined>()
  const [reauthOpen, setReauthOpen] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const searchId = useId()

  const reload = useCallback(async () => {
    setItems(await loadVaultItems(cache, session.vaultKey))
  }, [cache, session.vaultKey])

  const { status, syncNow } = useSync({
    cache,
    vaultKey: session.vaultKey,
    onSynced: () => void reload(),
    onRevoked,
  })
  useAutoLock(onLock)

  // Show what the cache already holds right away, before the first sync finishes.
  useEffect(() => {
    void reload()
  }, [reload])

  const changed = async () => {
    await reload()
    void syncNow()
  }

  const save = async (target: ItemFormTarget, draft: ItemDraft): Promise<SaveError | null> => {
    const result =
      target.kind === 'new'
        ? await createItem(cache, session.vaultKey, draft)
        : await updateItem(cache, session.vaultKey, target.id, draft)
    if (!result.ok) return result.error
    if (target.kind === 'new' && typeof result.value === 'string') setSelectedId(result.value)
    await changed()
    return null
  }

  const patch = async (id: string, change: Parameters<typeof patchItem>[3]) => {
    const result = await patchItem(cache, session.vaultKey, id, change)
    setNotice(result.ok ? null : 'That change could not be saved on this device.')
    await changed()
  }

  const runTotpAction = async (action: TotpAction, totpCode: string): Promise<string | null> => {
    const token = (await readMeta(cache))?.token
    if (!token) return 'This device has no session.'
    const reply =
      action.kind === 'delete'
        ? await api.deleteItem(token, action.item.id, action.item.revision, totpCode)
        : await api.emptyTrash(token, totpCode)
    if (!reply.ok) return actionErrorText(reply.error)
    setSelectedId(undefined)
    void syncNow()
    return null
  }

  const folders = useMemo(() => (items ? foldersOf(items) : []), [items])
  const listed = useMemo(() => (items ? filterItems(items, filter) : undefined), [items, filter])
  const trashCount = useMemo(
    () => (items ?? []).filter((item) => item.kind === 'item' && item.payload.trashed).length,
    [items],
  )
  const selected = items?.find(
    (item): item is OpenVaultItem => item.kind === 'item' && item.id === selectedId,
  )
  const title = filter.folder ?? VIEW_TITLE[filter.view]

  const setListView = (next: Partial<ListFilter>) => {
    setFilter((current) => ({ ...current, ...next }))
    setSelectedId(undefined)
  }

  return (
    <div className="vault">
      <a className="skip-link" href="#main">
        Skip to the content
      </a>
      <header className="toolbar">
        <Brand />
        <nav aria-label="Sections" className="nav">
          {VIEWS.map(([name, label]) => (
            <button
              key={name}
              type="button"
              className="nav-link"
              aria-current={view === name ? 'page' : undefined}
              onClick={() => setView(name)}
            >
              {label}
            </button>
          ))}
        </nav>
        <div className="toolbar-end">
          <p className="status" role="status">
            {statusText(status)}
          </p>
          <button className="btn" type="button" onClick={onLock}>
            Lock
          </button>
        </div>
      </header>

      {sessionExpired(status) ? (
        <div className="banner" role="alert">
          <p>
            Your session has ended. Your vault and unsent changes are safe on this device, but they
            will not sync until you sign in again.
          </p>
          <button className="btn" type="button" onClick={() => setReauthOpen(true)}>
            Sign in again
          </button>
        </div>
      ) : null}

      <main className="vault-main" id="main" data-view={view}>
        {view === 'items' ? (
          <div className="vault-grid">
            <aside className="filters" aria-label="Filters">
              {(['all', 'favorites', 'trash'] as const).map((name) => (
                <button
                  key={name}
                  type="button"
                  className="filter-link"
                  aria-current={filter.view === name && filter.folder === null ? 'true' : undefined}
                  onClick={() => setListView({ view: name, folder: null })}
                >
                  {VIEW_TITLE[name]}
                  {name === 'trash' && trashCount > 0 ? ` (${trashCount})` : ''}
                </button>
              ))}
              {folders.length > 0 ? <p className="filters-title">Folders</p> : null}
              {folders.map((folder) => (
                <button
                  key={folder}
                  type="button"
                  className="filter-link"
                  aria-current={filter.folder === folder ? 'true' : undefined}
                  onClick={() => setListView({ view: 'all', folder })}
                >
                  {folder}
                </button>
              ))}
            </aside>

            <section className="list-pane" data-hidden-narrow={selected !== undefined}>
              <div className="vault-head">
                <h1>{title}</h1>
                <div className="kit-actions">
                  <button
                    className="btn btn-primary"
                    type="button"
                    onClick={() => setFormTarget({ kind: 'new', type: 'login' })}
                  >
                    New login
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setFormTarget({ kind: 'new', type: 'note' })}
                  >
                    New note
                  </button>
                  <button
                    className="btn"
                    type="button"
                    onClick={() => setFormTarget({ kind: 'new', type: 'identity' })}
                  >
                    New identity
                  </button>
                </div>
              </div>
              <div className="field">
                <label htmlFor={searchId}>Search</label>
                <input
                  id={searchId}
                  type="search"
                  value={filter.query}
                  onChange={(event) =>
                    setFilter((current) => ({ ...current, query: event.target.value }))
                  }
                  placeholder="Name, username, website, or folder"
                  autoComplete="off"
                />
              </div>
              {notice ? (
                <p className="notice notice-error" role="alert">
                  {notice}
                </p>
              ) : null}
              {filter.view === 'trash' && trashCount > 0 ? (
                <div className="notice">
                  <p>Items in the trash are removed for good after 30 days.</p>
                  <button
                    className="btn btn-danger btn-small"
                    type="button"
                    onClick={() => setTotpAction({ kind: 'empty-trash' })}
                  >
                    Empty the trash now
                  </button>
                </div>
              ) : null}
              {listed === undefined ? (
                <p className="status" role="status">
                  Opening your vault…
                </p>
              ) : listed.length === 0 ? (
                <div className="empty">
                  {items?.length === 0 ? (
                    <>
                      <h2>Your vault is empty</h2>
                      <p>
                        Add your first login. It is encrypted on this device before it is sent
                        anywhere.
                      </p>
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => setFormTarget({ kind: 'new', type: 'login' })}
                      >
                        Add a login
                      </button>
                    </>
                  ) : (
                    <>
                      <h2>Nothing here</h2>
                      <p>
                        {filter.query.trim() !== ''
                          ? 'No item matches that search.'
                          : filter.view === 'trash'
                            ? 'The trash is empty.'
                            : 'No items in this view yet.'}
                      </p>
                    </>
                  )}
                </div>
              ) : (
                <ItemList
                  items={listed}
                  selectedId={selectedId}
                  onSelect={setSelectedId}
                  label={title}
                />
              )}
            </section>

            <section className="detail-pane" data-empty={selected === undefined}>
              {selected ? (
                <ItemDetail
                  key={selected.id}
                  item={selected}
                  onBack={() => setSelectedId(undefined)}
                  onEdit={() =>
                    setFormTarget({ kind: 'edit', id: selected.id, payload: selected.payload })
                  }
                  onToggleFavorite={() =>
                    void patch(selected.id, { favorite: !selected.payload.favorite })
                  }
                  onTrash={() => void patch(selected.id, { trashed: true })}
                  onRestore={() => void patch(selected.id, { trashed: false })}
                  onDeleteForever={() =>
                    selected.revision === 0 || selected.pending
                      ? setNotice('This item has not finished syncing yet. Try again after a sync.')
                      : setTotpAction({ kind: 'delete', item: selected })
                  }
                  onDiscardCopies={() => void patch(selected.id, { conflict_copies: [] })}
                  onDismissRollback={() =>
                    void dismissRollbackFlag(cache, selected.id).then(reload)
                  }
                />
              ) : (
                <p className="detail-placeholder">Choose an item to see it here.</p>
              )}
            </section>
          </div>
        ) : null}
        {view === 'generator' ? <GeneratorScreen /> : null}
        {view === 'import' ? (
          <ImportScreen
            cache={cache}
            vaultKey={session.vaultKey}
            items={items ?? []}
            onImported={() => void changed()}
          />
        ) : null}
        {view === 'devices' ? <DevicesScreen cache={cache} onSignedOut={onRevoked} /> : null}
        {view === 'settings' ? (
          <SettingsScreen
            cache={cache}
            session={session}
            onSessionChange={(next) => {
              onSessionChange?.(next)
              void syncNow()
            }}
            onRecover={() => onRecover?.()}
          />
        ) : null}
      </main>

      <ItemFormDialog
        target={formTarget}
        folders={folders}
        onClose={() => setFormTarget(undefined)}
        onSave={save}
      />
      <TotpDialog
        open={totpAction !== undefined}
        title={totpAction?.kind === 'delete' ? 'Delete forever' : 'Empty the trash'}
        description={
          totpAction?.kind === 'delete'
            ? `"${totpAction.item.payload.name}" will be removed for good from the server and every device. This cannot be undone.`
            : 'Every item in the trash will be removed for good from the server and every device. This cannot be undone.'
        }
        confirmLabel={totpAction?.kind === 'delete' ? 'Delete forever' : 'Empty the trash'}
        onConfirm={(code) => (totpAction ? runTotpAction(totpAction, code) : Promise.resolve(null))}
        onClose={() => setTotpAction(undefined)}
      />
      <ReauthDialog
        open={reauthOpen}
        cache={cache}
        onClose={() => setReauthOpen(false)}
        onSignedIn={(meta: CacheMeta) => {
          onSessionChange?.({ ...session, meta })
          void syncNow()
        }}
      />
    </div>
  )
}
