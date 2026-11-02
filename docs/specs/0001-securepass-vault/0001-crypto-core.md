# 0001.1 Crypto core: key hierarchy and envelope format

## Summary

`packages/crypto` is the only code allowed to touch keys. It turns your master password into two separate keys (one to unlock, one to prove who you are to the server), keeps a random vault key that unlocks per item keys, and seals every item with an encryption mode that detects any tampering. It has no legacy modes, refuses weak or absurd settings, and notices when the server hands back an older copy of an item. Those are the main gaps found in LastPass.

## Decision

Argon2id (`hash-wasm`) stretches the password, HKDF SHA-256 (WebCrypto) splits it into an encryption key and an auth key, and `XChaCha20-Poly1305` (`@noble/ciphers`) seals every key and item with a fresh random 24 byte nonce and associated data (AD, extra data the tag also protects) that binds each ciphertext to its purpose, id, and settings. Short rationale: XChaCha's long nonce makes random nonces safe forever, the AEAD tag gives tamper checks LastPass's CBC lacks, and separate HKDF outputs mean the server's auth proof can never decrypt anything. Runner up: WebCrypto `AES-256-GCM` with 96 bit nonces (native and fast, but random nonce limits and no X25519 for later sharing).

## Feature design

**Key hierarchy**:

```
account_id = UUID v4 made by the client at setup (sent to the server in /api/setup)
master password ──NFC normalize──► Argon2id(salt=kdf_salt 16 random bytes, kdf params, 32 bytes) = master_key
master_key ──HKDF SHA-256, info "securepass/v1/enc"──► enc_key   (never leaves device)
master_key ──HKDF SHA-256, info "securepass/v1/auth"─► auth_key  (sent to server as login proof)

vault_key = 32 random bytes (made once at setup)
wrapped_vault_key           = seal(enc_key, vault_key, ad = "vault-key|" + account_id + "|" + canonical_json(kdf) + "|" + b64(kdf_salt))
recovery_key = 32 random bytes, shown as Base32 in groups of 4 (the recovery kit)
recovery_enc_key  = HKDF(recovery_key, info "securepass/v1/recovery")
recovery_auth_key = HKDF(recovery_key, info "securepass/v1/recovery-auth")
wrapped_vault_key_recovery  = seal(recovery_enc_key, vault_key, ad = "vault-key-recovery|" + account_id)

per item: item_key = 32 random bytes
item ciphertext = { wrapped_item_key: seal(vault_key, item_key, ad = "item-key|" + item_id),
                    payload:          seal(item_key, JSON(ItemPayload), ad = "item|" + item_id) }

PIN (extension only, 6+ characters): pin_key = Argon2id(NFC(PIN), pin_salt 16 random bytes, floor params)
pin_wrapped_vault_key = seal(pin_key, vault_key, ad = "pin|" + device_id)   (memory only, see 0004)
```

Binding `kdf` and `kdf_salt` into the vault key AD means a server that swaps the settings makes unlock fail instead of silently weakening it.

**Envelope format** (`seal` output, base64url in JSON): `0x01` version byte, 24 byte nonce, ciphertext with 16 byte Poly1305 tag. The AD bytes passed to the cipher are `[0x01] + utf8("securepass/v1|" + ad)`, so the version byte is explicitly authenticated. Every envelope type uses its own AD prefix (`vault-key`, `vault-key-recovery`, `item-key`, `item`, `pin`). Any unknown version byte is rejected; there is no fallback.

**KDF rules** (`assertKdf`):
- `alg` must be `"argon2id"`; anything else throws `UnsupportedKdfError`.
- Floor: m ≥ 65536 KiB, t ≥ 3, p ≥ 1. Ceiling: m ≤ 1048576 KiB (1 GiB), t ≤ 10, p ≤ 4. Out of range throws `WeakKdfError` or `KdfOutOfRangeError`.
- Pinning: the device stores the last accepted `kdf` in its cache `meta`. A server value lower in any parameter than the pinned one is rejected (`KdfDowngradeError`), even if above the floor. Higher values are accepted and pinned after a successful unlock.
- Argon2id runs in a page context (web vault tab, extension popup, or offscreen document), never in the MV3 service worker, which may be stopped mid run under memory pressure.

**ItemPayload** (`packages/shared`, the plaintext inside `payload`):

| Field              | Type                                                                                                   | Notes                                                                                                    |
| ------------------ | ------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------- |
| `v`                | `1`                                                                                                    | Payload schema version                                                                                   |
| `seq`              | integer                                                                                                | Starts at 1, the editing device sets it to (highest seen + 1) on every edit; used for rollback detection |
| `type`             | `"login" \| "note" \| "identity"`                                                                      | Hidden from the server                                                                                   |
| `name`             | string                                                                                                 | Required, max 256 chars                                                                                  |
| `folder`           | string \| null                                                                                         | Free text folder path                                                                                    |
| `favorite`         | boolean                                                                                                |                                                                                                          |
| `trashed`          | boolean                                                                                                | The trusted trash state (the server's `deleted_at` is only for purging)                                  |
| `edited_at`        | ISO string                                                                                             | Set by the editing device                                                                                |
| `edited_by`        | string                                                                                                 | Editing device id, tie breaker                                                                           |
| `login`            | `{ username, password, urls: { url, match: "domain" \| "host" }[], totp_secret \| null }`              | Login only; `match` defaults to `"domain"`                                                               |
| `password_history` | `{ password, replaced_at }[]` max 5                                                                    | Login only, newest first                                                                                 |
| `conflict_copies`  | `{ payload, kept_at }[]` max 5                                                                         | Full losing versions from sync conflicts (see 0003)                                                      |
| `note`             | string                                                                                                 | All types                                                                                                |
| `identity`         | `{ title, first, last, email, phone, address1, address2, city, region, postal, country }` all nullable | Identity only                                                                                            |

The sealed item (wrapped key plus payload) must stay under 64 KiB; `sealItem` throws `ItemTooLargeError` above that.

**Rollback detection**: the device stores `seen_seq[item_id]` in cache `meta`. If a synced item opens to a `seq` lower than `seen_seq`, the client keeps its cached copy, flags "the server sent an older version of this item", and does not overwrite. Hidden items (a server that withholds rows) are not detected in v1; that limit is written in index.md Consequences.

**Public API of `packages/crypto`** (all async, all take and return `Uint8Array` or typed objects):
`newAccountId()` · `deriveMasterKey(password, kdf, pinned_kdf)` · `splitKeys(master_key) → { enc_key, auth_key }` · `newVaultKey()` · `wrapVaultKey / unwrapVaultKey(account_id, kdf, kdf_salt)` · `newRecoveryKit() → { recovery_key, display, recovery_auth_key, recovery_enc_key }` · `sealItem(vault_key, item_id, payload)` · `openItem(vault_key, item_id, ciphertext) → payload | DamagedItemError` · `wrapWithPin / unwrapWithPin(device_id)` · `assertKdf(kdf, pinned_kdf)` · `zeroize(buf)`.

**Value sourcing**:

| Action     | Value                                      | Source                                                                          |
| ---------- | ------------------------------------------ | ------------------------------------------------------------------------------- |
| Setup      | `account_id`                               | `newAccountId()` on the client                                                  |
| Unlock     | `kdf`, `kdf_salt`                          | prelogin (0002), or cache `meta` when offline                                   |
| Unlock     | pinned `kdf`                               | cache `meta.pinned_kdf` (absent on a brand new device: floor applies)           |
| Seal item  | `item_id`                                  | UUID v4 made on the client when the item is created                             |
| Seal item  | `seq`                                      | `max(seen_seq[item_id], payload.seq) + 1`                                       |
| Seal item  | nonces, item keys, vault key, recovery key | `crypto.getRandomValues`                                                        |
| PIN wrap   | `device_id`                                | UUID v4 made at first launch of the extension, stored in `chrome.storage.local` |
| KDF limits | floor and ceiling                          | constants `KDF_FLOOR`, `KDF_CEILING` in `packages/crypto`                       |

**Key invariants**:
- `assertKdf` runs before every derivation.
- No nonce is ever derived from a key or reused; every `seal` draws a fresh nonce.
- `enc_key`, `vault_key`, and item keys never cross the network. `auth_key` and `recovery_auth_key` are the only derived values that do.
- `openItem` returns a `DamagedItemError` on any failure; callers show "damaged item" and never retry with another mode.
- Password change and recovery rewrap the same `vault_key`; someone holding an old wrapped key and the old password can still open it (written in Consequences). Rotating the vault key is a later option.
- Key buffers are zeroized on lock where the runtime allows it (best effort in JS).

**Security model**: pure functions, no I/O, no logging. The package has no dependency on any app.

**Critical test scenarios**:
- Argon2id matches RFC 9106 test vectors and HKDF matches RFC 5869 vectors, verifies **AC-5**.
- Seal then open round trips every payload type, verifies **AC-7**.
- Flipping any byte of an envelope (including the version byte), or opening under a different `item_id`, throws `DamagedItemError`, verifies **AC-6**.
- m=19456 throws `WeakKdfError`; m=4194304 throws `KdfOutOfRangeError`; a server kdf below the pinned one throws `KdfDowngradeError`; changing `kdf_salt` makes vault key unwrap fail, verifies **AC-3**.
- An item with lower `seq` than `seen_seq` is not applied, verifies **AC-6**.
- Recovery kit unwraps the same vault key as the password path, verifies **AC-20**.
- Derivation at the floor takes under 2 seconds in Chromium on the reference laptop (benchmark, recorded not gated), verifies **AC-5**.

## Build plan

1. (slice 1) Scaffold `packages/crypto` with `seal`/`open` envelope, version byte in AD, per type prefixes, satisfies **AC-6**.
2. (slice 1) `deriveMasterKey` with `hash-wasm`, NFC normalization, `assertKdf` (floor, ceiling, alg, pinning), RFC 9106 vectors, satisfies **AC-3**, **AC-5**.
3. (slice 1) `splitKeys` via WebCrypto HKDF with RFC 5869 vectors, satisfies **AC-2**.
4. (slice 1) `newAccountId`, vault key wrap with kdf bound AD, item key wrapping, `sealItem` / `openItem`, `ItemPayload` zod schema, size cap, satisfies **AC-6**, **AC-7**, **AC-23**.
5. Rollback check helper (`seq` vs `seen_seq`), satisfies **AC-6**.
6. Recovery kit generation and unwrap, satisfies **AC-20**.
7. PIN wrap and unwrap with 6 character minimum, satisfies **AC-13**.
8. Tamper, wrong id, KDF range suite plus unlock benchmark, satisfies **AC-3**, **AC-5**, **AC-6**.
