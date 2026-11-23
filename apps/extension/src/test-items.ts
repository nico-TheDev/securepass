import type { OpenVaultItem, SavedUrl } from '@securepass/vault'

/** A login item for tests. */
export const loginItem = (
  id: string,
  name: string,
  username: string,
  password: string,
  urls: readonly (string | SavedUrl)[],
  extra: { readonly trashed?: boolean } = {},
): OpenVaultItem => ({
  kind: 'item',
  id,
  revision: 1,
  pending: false,
  deletedAt: null,
  rolledBack: false,
  payload: {
    v: 1,
    seq: 1,
    type: 'login',
    name,
    folder: null,
    favorite: false,
    trashed: extra.trashed ?? false,
    edited_at: '2026-11-11T00:00:00.000Z',
    edited_by: 'test-device',
    note: '',
    login: {
      username,
      password,
      urls: urls.map((url) => (typeof url === 'string' ? { url, match: 'domain' } : url)),
      totp_secret: null,
    },
  },
})
