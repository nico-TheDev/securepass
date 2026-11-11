import type { Device } from '@securepass/shared'
import { type Cache, readMeta } from '@securepass/shared/cache'
import { useCallback, useEffect, useState } from 'react'
import { api } from '../auth/api'
import { actionErrorText } from '../ui/errors'
import { TotpDialog } from '../ui/totp-dialog'

type Props = {
  readonly cache: Cache
  /** Called when this device itself was signed out, so its local copy is wiped. */
  readonly onSignedOut: () => void
}

const dateText = (seconds: number): string =>
  new Date(seconds * 1000).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })

/** Every signed in device with its last use, and a way to sign one out. */
export function DevicesScreen({ cache, onSignedOut }: Props) {
  const [devices, setDevices] = useState<readonly Device[] | undefined>()
  const [error, setError] = useState<string | null>(null)
  const [revoking, setRevoking] = useState<Device | undefined>()

  const load = useCallback(async () => {
    const token = (await readMeta(cache))?.token
    if (!token) return
    const reply = await api.devices(token)
    if (reply.ok) {
      setDevices(reply.value)
      setError(null)
    } else setError(actionErrorText(reply.error))
  }, [cache])

  useEffect(() => {
    void load()
  }, [load])

  const revoke = async (device: Device, totpCode: string): Promise<string | null> => {
    const token = (await readMeta(cache))?.token
    if (!token) return 'This device has no session.'
    const reply = await api.revokeDevice(token, device.id, totpCode)
    if (!reply.ok) return actionErrorText(reply.error)
    if (device.current) onSignedOut()
    else void load()
    return null
  }

  return (
    <div className="page">
      <h1>Devices</h1>
      <section className="panel" aria-labelledby="devices-title">
        <h2 id="devices-title">Signed in devices</h2>
        <p>
          Signing a device out needs a fresh authenticator code. A signed out device locks and wipes
          its local copy the next time it talks to the server.
        </p>
        {error ? (
          <p className="notice notice-error" role="alert">
            {error}
          </p>
        ) : null}
        {devices === undefined && !error ? <p role="status">Loading devices…</p> : null}
        {devices ? (
          <ul className="item-list" aria-label="Devices">
            {devices.map((device) => (
              <li key={device.id} className="item-row">
                <div>
                  <p className="item-name">
                    {device.name}
                    {device.current ? ' (this device)' : ''}
                  </p>
                  <p className="item-sub">
                    Signed in {dateText(device.created_at)} · Last used{' '}
                    {dateText(device.last_seen_at)}
                  </p>
                </div>
                <button className="btn" type="button" onClick={() => setRevoking(device)}>
                  Sign out<span className="visually-hidden"> {device.name}</span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
        <div className="kit-actions">
          <button className="btn" type="button" onClick={() => void load()}>
            Refresh
          </button>
        </div>
      </section>
      <TotpDialog
        open={revoking !== undefined}
        title={revoking?.current ? 'Sign out this device' : 'Sign out a device'}
        description={
          revoking?.current
            ? 'This signs out the device you are using now and wipes its local copy. Changes that have not synced yet will be lost.'
            : `This signs out "${revoking?.name ?? ''}". It will lock and wipe its local copy.`
        }
        confirmLabel="Sign out"
        onConfirm={(code) => (revoking ? revoke(revoking, code) : Promise.resolve(null))}
        onClose={() => setRevoking(undefined)}
      />
    </div>
  )
}
