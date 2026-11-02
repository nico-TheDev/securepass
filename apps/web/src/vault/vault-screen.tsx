import type { Cache } from '@securepass/shared/cache'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { Session } from '../auth/vault-session'
import { ItemList } from '../items/item-list'
import { NewLoginDialog } from '../items/new-login-dialog'
import {
  createLogin,
  type LoginDraft,
  listedItems,
  loadVaultItems,
  type VaultItem,
} from '../items/vault-items'
import { type SyncStatus, useSync } from '../sync/use-sync'
import { Brand } from '../ui/brand'
import { useAutoLock } from './use-auto-lock'

type Props = {
  readonly cache: Cache
  readonly session: Session
  readonly onLock: () => void
  readonly onRevoked: () => void
}

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

/** The unlocked vault: a toolbar, the item list, and the new login dialog. */
export function VaultScreen({ cache, session, onLock, onRevoked }: Props) {
  const [items, setItems] = useState<readonly VaultItem[] | undefined>()
  const [dialogOpen, setDialogOpen] = useState(false)
  const metaRef = useRef(session.meta)

  const reload = useCallback(async () => {
    setItems(await loadVaultItems(cache, session.vaultKey))
  }, [cache, session.vaultKey])

  const { status, syncNow } = useSync({ cache, onSynced: () => void reload(), onRevoked })
  useAutoLock(onLock)

  // Show what the cache already holds right away, before the first sync finishes.
  useEffect(() => {
    void reload()
  }, [reload])

  const save = async (draft: LoginDraft): Promise<boolean> => {
    const created = await createLogin(cache, session.vaultKey, draft)
    if (!created.ok) return false
    metaRef.current = created.value
    await reload()
    void syncNow()
    return true
  }

  const listed = useMemo(() => (items ? listedItems(items) : undefined), [items])

  return (
    <div className="vault">
      <header className="toolbar">
        <Brand />
        <div className="toolbar-end">
          <p className="status" role="status">
            {statusText(status)}
          </p>
          <button className="btn" type="button" onClick={onLock}>
            Lock
          </button>
        </div>
      </header>
      <main className="vault-main">
        <div className="vault-head">
          <h1>Logins</h1>
          <button className="btn btn-primary" type="button" onClick={() => setDialogOpen(true)}>
            New login
          </button>
        </div>
        {listed === undefined ? (
          <p className="status" role="status">
            Opening your vault…
          </p>
        ) : listed.length === 0 ? (
          <div className="empty">
            <h2>Your vault is empty</h2>
            <p>Add your first login. It is encrypted on this device before it is sent anywhere.</p>
            <button className="btn btn-primary" type="button" onClick={() => setDialogOpen(true)}>
              Add a login
            </button>
          </div>
        ) : (
          <ItemList items={listed} />
        )}
      </main>
      <NewLoginDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSave={save} />
    </div>
  )
}
