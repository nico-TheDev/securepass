# 0001.3 Web vault: React + Vite single page app

## Summary

The web vault is where you set up the account, unlock, and manage items. It runs only in your browser, keeps an encrypted copy of the vault in IndexedDB so it works offline, and does imports, password generation, and breach checks without sending anything readable anywhere. Because the server delivers this page, a hacked server could change it, so type your master password here only on devices you trust; the extension is the trusted client.

## Decision

A static React + Vite SPA served from the same Worker as the API, using `packages/crypto` and the shared local cache module. Short rationale: same origin removes CORS and lets one strict CSP cover everything; a static SPA has no server render path that could see secrets. Runner up: a separate Pages origin with locked deploys (limits what an API break in can change, but adds CORS and a second deploy). The trust limit this creates is stated in index.md.

## Feature design

**Screens**: Setup (email, master password with strength meter, recovery kit download and confirm), TOTP enrollment (forced right after setup: QR, confirm code, recovery codes), Unlock, Item list (search, folder filter, favorites, trash view), Item view and edit (per type, password history, conflict copies, copy buttons), Generator, Import, Devices, Settings (change master password, recover). A banner on Unlock reminds you to unlock here only on trusted devices.

**Recovery kit**: a text file `securepass-recovery-kit.txt` with the recovery key (Base32 groups of 4), the email, the server URL, and the date. "Confirm" means retyping the last group of the key before setup finishes.

**Local cache** (`packages/shared/cache`, IndexedDB, used by web vault and extension):

| Store         | Contents                                                                                                                                  |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `meta`        | `account_id`, `email`, `kdf`, `kdf_salt`, `pinned_kdf`, `wrapped_vault_key`, `last_revision`, device `token`, `device_id`, `seen_seq` map |
| `items`       | server rows as received: `id`, `revision`, `ciphertext`, timestamps, `deleted_at`, `purged`                                               |
| `pending_ops` | queued writes: `{ op: put \| delete, id, base_revision, ciphertext, trashed, queued_at }` in order                                        |

Decrypted payloads live only in memory while unlocked and are dropped on lock. On unlock the client decrypts every item once to build an in memory search index (name, folder, usernames, URL domains); in the extension the index is rebuilt lazily when the service worker wakes.

**Sync loop**: on unlock, after every local write, every 5 minutes while unlocked, and on `online` events: flush `pending_ops` in order, then `GET /api/sync?since=last_revision`. Items with `purged: true` are removed from the cache. `full_resync` clears `items` and pulls everything (pending ops are kept and flushed after).

**Conflict rules** (on a 409, after opening the server item):
1. If one side has `trashed` true and the other has an edit made after the trash, the edit wins and the item is restored.
2. Otherwise the newer `edited_at` wins, but only if it is no more than 5 minutes ahead of the server item's `updated_at` (a fast device clock loses to the server copy).
3. A tie goes to the higher `edited_by` device id.
4. The losing payload is kept whole in the winner's `conflict_copies` (max 5, oldest dropped), and the loser's password goes into `password_history` if it differs. The item view shows a notice until you open the copies.
5. The winner is sealed with a new `seq` and sent again with the new base revision. A queued op whose base is stale goes through the same rules, so replays never overwrite blindly.

**Revoked vs expired**: on `401 revoked` the client locks, clears every store, and shows "This device was signed out". On `401 expired` it keeps the cache and the pending ops and asks you to log in again (auth key plus TOTP); after login the queue flushes.

**Password history**: whenever a login's password changes (edit, import update, conflict), the old value is pushed with `replaced_at` = the editing device's time, unless it equals the newest history entry. Only the 5 newest are kept.

**Import (LastPass CSV)**: parse locally with `papaparse` (handles BOM, CRLF, quoted multiline fields). Column mapping:

| LastPass column        | ItemPayload                                                                           |
| ---------------------- | ------------------------------------------------------------------------------------- |
| `url`                  | `login.urls[0]` (`match: "domain"`); a URL of `http://sn` makes the row a secure note |
| `username`, `password` | `login.username`, `login.password`                                                    |
| `totp`                 | `login.totp_secret`                                                                   |
| `extra`                | `note`                                                                                |
| `name`                 | `name` (falls back to the URL's host)                                                 |
| `grouping`             | `folder` (`(none)` and empty become null)                                             |
| `fav`                  | `favorite` (`1` = true)                                                               |

Secure notes whose `extra` starts with `NoteType:` (LastPass structured notes such as cards) are imported as a plain note holding the raw text, with skip reason `structured_note_as_text`. Skip reasons: `no_name_no_url`, `too_large` (over 64 KiB sealed), `duplicate` (same name, username, and URL domain as an existing item), `parse_error`. Items are sealed and queued 50 at a time; `edited_at` is the import time. A summary lists imported, skipped, and why. The file is read with the File API and never uploaded.

**Generator** (shared with the extension): `crypto.getRandomValues` with rejection sampling (no modulo bias). Passwords: default 20 characters, upper, lower, digits, symbols; range 8 to 128; option to exclude look alikes (`Il1O0`); at least one character from each chosen set. Passphrases: default 5 words from the bundled EFF large wordlist (7776 words), separator `-`, capitalized first letter, optional number; range 3 to 12.

**Breach check**: SHA-1 of the password, send the first 5 hex characters to the Have I Been Pwned range API with `Add-Padding: true`, match the rest locally, show the count.

**Clipboard**: best effort in the web vault: after 30 seconds, if the tab has focus and `navigator.clipboard.readText` is allowed and still returns the copied value, write an empty string. The extension does this reliably (0004).

**Value sourcing**:

| Action         | Value                                                | Source                                                                                  |
| -------------- | ---------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Unlock offline | `kdf`, `kdf_salt`, `pinned_kdf`, `wrapped_vault_key` | `meta` store                                                                            |
| Item list      | names, folders, types                                | in memory search index                                                                  |
| Conflict       | winner                                               | rules above, using payload `edited_at`, `edited_by`, `trashed`, and server `updated_at` |
| Strength meter | score                                                | `zxcvbn-ts` run locally                                                                 |
| Import         | defaults                                             | name from host, folder null, `edited_at` now                                            |

**Key invariants**:
- No plaintext item data, keys, or master password is written to IndexedDB, `localStorage`, or logs.
- The master password field is cleared right after derivation; keys are dropped on lock and tab close.
- Auto lock after 15 minutes without activity in the tab.
- The CSP is the one set by the server (0002).

**Critical test scenarios** (Playwright):
- Setup, forced TOTP enrollment, add a login, reload, unlock, see it, verifies **AC-1**, **AC-5**, **AC-7**.
- Go offline, unlock, edit, go online, the edit reaches the server, verifies **AC-10**.
- Two devices edit the same item offline then sync; the newer wins, the loser is in `conflict_copies`, the older password is in history, verifies **AC-9**, **AC-12**.
- Trash on one device, purge, the item disappears from another device's cache, verifies **AC-11**.
- Import a sample LastPass CSV with a structured note, a duplicate, and a bad row; counts and reasons shown; the network log shows no upload, verifies **AC-17**.
- Breach check request URL contains only a 5 character prefix, verifies **AC-18**.
- Recover with the kit, set a new password, the old kit fails, verifies **AC-20**.
- `401 expired` keeps pending ops; `401 revoked` wipes, verifies **AC-22**.

## Build plan

1. (slice 1) `apps/web` Vite React app served by the Worker; Setup (with recovery kit) and Unlock screens, satisfies **AC-1**, **AC-5**, **AC-20**.
2. (slice 1) Shared cache module and sync loop (pull, push, purged rows), item list and login create, satisfies **AC-7**, **AC-8**.
3. Forced TOTP enrollment screen, satisfies **AC-4**.
4. Notes and identities, edit, password history, trash and restore, satisfies **AC-7**, **AC-11**, **AC-12**.
5. Offline queue, conflict rules, conflict copies, revoked vs expired handling, satisfies **AC-9**, **AC-10**, **AC-22**.
6. Generator and breach check, satisfies **AC-16**, **AC-18**.
7. LastPass CSV import, satisfies **AC-17**.
8. Devices screen, change password, recovery flow, clipboard clear, satisfies **AC-19**, **AC-20**, **AC-21**, **AC-22**.
