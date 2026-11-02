# 0001.2 Sync server: Hono on Cloudflare Workers + D1

## Summary

The server is a small, careful store for ciphertext. It knows you by an auth key derived from your password (never the password itself), asks for a TOTP code, hands each device its own revocable token, and keeps item versions in order so devices can sync. It cannot read anything in your vault, and it slows down guessing without ever locking you out.

## Decision

A single Hono app on Cloudflare Workers with D1, Drizzle schema, and wrangler migrations. The stored auth proof is `HMAC-SHA256(AUTH_HMAC_KEY, auth_key)`, compared in constant time. Short rationale: `auth_key` is already 256 bits of Argon2id backed key material, so a slow server hash adds only Workers CPU cost; the HMAC key means a database leak alone cannot test guesses. Runner up: PBKDF2 over `auth_key` on the server (Bitwarden style). Device sessions use opaque random tokens (32 bytes, stored as SHA-256), 30 day sliding expiry, instead of JWTs, because one user's lookups are cheap and revocation is instant. Runner up: short JWT plus refresh token pair. Sensitive actions (password change, device revoke, empty trash, permanent delete) also need a fresh TOTP code, which limits what a stolen token can do.

## Feature design

**Data model** (D1):

| Table            | Columns                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Constraints                                         |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| `account`        | `id` text PK (client made), `email` text unique (trimmed, lowercased), `kdf` text JSON `{alg, m, t, p}`, `kdf_salt` blob, `auth_key_hmac` blob, `recovery_auth_hmac` blob, `wrapped_vault_key` blob, `wrapped_vault_key_recovery` blob, `totp_secret_enc` blob null, `totp_enabled` int, `totp_last_step` int null, `recovery_code_hmacs` text JSON, `recovery_token_hash` blob null, `recovery_token_expires_at` int null, `revision` int default 0, `created_at` int | At most one row (setup refuses a second)            |
| `device_session` | `id` text PK, `account_id` FK, `device_name` text, `token_hash` blob unique, `created_at`, `last_seen_at`, `expires_at`, `revoked_at` null                                                                                                                                                                                                                                                                                                                             | Index on `token_hash`                               |
| `item`           | `id` text PK (client UUID), `account_id` FK, `revision` int, `ciphertext` blob null (null = purged tombstone), `size` int, `created_at`, `updated_at`, `deleted_at` null, `purge_after` null, `purged_at` null                                                                                                                                                                                                                                                         | Index on (`account_id`, `revision`); `size` ≤ 65536 |
| `login_attempt`  | `id` PK, `ip_hash` blob, `account_id` null, `kind` text (`login` \| `recover` \| `totp`), `at` int, `outcome` text                                                                                                                                                                                                                                                                                                                                                     | Index on (`ip_hash`, `at`), (`account_id`, `at`)    |

Added beyond the first confirmed model, because the cross check showed they are needed: `totp_last_step` (stops TOTP code reuse), recovery token columns (recovery flow), `purged_at` and nullable `ciphertext` (tombstones so other devices learn about purges), `login_attempt.kind`.

**API surface** (all JSON, all bodies validated by zod from `packages/shared`; bearer = device token; "fresh TOTP" = a valid `totp_code` in the body):

| Endpoint                    | Method | Key inputs                                                                                                                                                                            | Key outputs                                                                                                 | Auth                     | Key errors                               |
| --------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- | ------------------------ | ---------------------------------------- |
| `/api/setup`                | POST   | `account_id`, `email`, `kdf`, `kdf_salt`, `auth_key`, `recovery_auth_key`, `wrapped_vault_key`, `wrapped_vault_key_recovery`, `device_name`                                           | device `token`                                                                                              | `X-Setup-Token` header   | 401, 409 exists, 422 kdf                 |
| `/api/auth/prelogin`        | POST   | `email`                                                                                                                                                                               | `kdf`, `kdf_salt`                                                                                           | none                     | 429                                      |
| `/api/auth/login`           | POST   | `email`, `auth_key`, `totp_code` or `recovery_code`, `device_name`                                                                                                                    | `token`, `account_id`, `wrapped_vault_key`, `revision`                                                      | none                     | 401, 429                                 |
| `/api/auth/recover`         | POST   | `email`, `recovery_auth_key`, `totp_code` or `recovery_code`                                                                                                                          | `recovery_token`, `wrapped_vault_key_recovery`                                                              | none                     | 401, 429                                 |
| `/api/auth/logout`          | POST   |                                                                                                                                                                                       | 204                                                                                                         | bearer                   | 401                                      |
| `/api/account/totp`         | POST   |                                                                                                                                                                                       | `otpauth_uri`, 10 `recovery_codes` (shown once)                                                             | bearer                   | 409 already on                           |
| `/api/account/totp/confirm` | POST   | `totp_code`                                                                                                                                                                           | 204, `totp_enabled = 1`                                                                                     | bearer                   | 422 bad code                             |
| `/api/account/password`     | POST   | (`current_auth_key` + fresh TOTP) or `recovery_token`; new `kdf`, `kdf_salt`, `auth_key`, `wrapped_vault_key`; on recovery also new `recovery_auth_key`, `wrapped_vault_key_recovery` | new `token` for this device; all other sessions revoked                                                     | bearer or recovery token | 401, 422 kdf                             |
| `/api/sync`                 | GET    | `since` revision                                                                                                                                                                      | `items[]` (id, revision, ciphertext or null, timestamps, `deleted_at`, `purged`), `revision`, `full_resync` | bearer                   | 401                                      |
| `/api/items/:id`            | PUT    | `If-Match: <base revision>` (0 = new), `ciphertext`, `trashed` flag                                                                                                                   | `revision`, `updated_at`, `purge_after`                                                                     | bearer                   | 409 + current item, 410 purged, 413 size |
| `/api/items/:id`            | DELETE | `If-Match`, fresh TOTP                                                                                                                                                                | 204, tombstone                                                                                              | bearer                   | 404, 409                                 |
| `/api/trash`                | DELETE | fresh TOTP                                                                                                                                                                            | 204, tombstones for all trashed                                                                             | bearer                   | 401                                      |
| `/api/devices`              | GET    |                                                                                                                                                                                       | `devices[]` (id, name, created, last seen, current)                                                         | bearer                   |                                          |
| `/api/devices/:id`          | DELETE | fresh TOTP                                                                                                                                                                            | 204 (the current device may revoke itself, which logs it out)                                               | bearer                   | 404                                      |

Trash and restore are ordinary `PUT`s of a new ciphertext whose payload has `trashed` true or false (the trusted state, see 0001). The client also sends a plain `trashed` flag so the server can set `deleted_at` and `purge_after` (now + 30 days) or clear them. Restoring an item past `purge_after` returns 410 even before the daily purge has run.

**401 bodies** carry `code`: `invalid` (bad credentials), `expired` (session past `expires_at`), `revoked` (session revoked). Clients wipe local data only on `revoked` (see 0003).

**Login limiter** (shared by `login`, `recover`, and fresh TOTP checks):
- Per IP: after 5 failures within an hour from one `ip_hash`, every request from that IP is answered 429 without checking credentials, with `Retry-After = 60 × 2^(n−5)` seconds (n = failures in the last hour, capped at 3600). So the 5th failure answers 401, the 6th attempt answers 429 with `Retry-After: 60`, the 7th with 120.
- Per account: after 20 failures in an hour across all IPs, each new attempt waits an extra 2 seconds before it is checked (slowing, never blocking), so an attacker cannot lock you out.
- A success clears the account counter and that IP's counter.
- Unknown emails and prelogin calls count toward the per IP limit only.
- Credentials are checked together: wrong `auth_key`, wrong TOTP, or both all return one `401 invalid`.

**TOTP**: RFC 6238, SHA-1, 6 digits, 30 second step, accept steps −1, 0, +1. The accepted step is stored in `totp_last_step`; a code for a step at or below it is rejected (no reuse). Login skips TOTP only while `totp_enabled = 0`, which lasts from setup until the web vault's forced enrollment (0003) confirms. Recovery codes: 10 codes of 16 Base32 characters (80 bits) each, stored as `HMAC(CODE_HMAC_KEY, code)`; a used code is removed.

**Recovery token**: 32 random bytes, returned once, stored as SHA-256 with a 10 minute expiry. Single use, accepted only by `POST /api/account/password`. Using it requires a new recovery kit (`recovery_auth_key`, `wrapped_vault_key_recovery`), issues 10 new recovery codes, and revokes every session.

**Value sourcing**:

| Action                  | Value                           | Source                                                                                            |
| ----------------------- | ------------------------------- | ------------------------------------------------------------------------------------------------- |
| prelogin, unknown email | fake `kdf_salt` and floor `kdf` | `HMAC(PRELOGIN_KEY, email)` first 16 bytes, so the reply does not reveal whether the email exists |
| any write               | new `revision`                  | `account.revision + 1`, written with the item in one D1 batch                                     |
| trash                   | `purge_after`                   | `updated_at + 30 days` when `trashed` is true                                                     |
| sync                    | `full_resync`                   | true when `since` is older than the oldest tombstone still kept (tombstones are kept 90 days)     |
| limiter                 | `ip_hash`                       | `HMAC(IP_HASH_KEY, CF-Connecting-IP)`; raw IPs are never stored                                   |
| device list             | `last_seen_at`                  | updated on each authenticated request, at most once per minute                                    |
| TOTP check              | secret                          | `totp_secret_enc` decrypted with `TOTP_ENC_KEY` (`AES-256-GCM`, WebCrypto)                        |

**Key invariants**:
- Writes are atomic: `account.revision` and the item row change in one D1 batch; revisions are strictly increasing.
- Every item mutation needs `If-Match`; a stale one never overwrites and returns 409 with the current row.
- Purge (daily Cron, permanent delete, empty trash) sets `ciphertext = NULL`, `purged_at = now`, and a new revision, so sync reports it; tombstone rows are deleted after 90 days. The Cron also removes `login_attempt` rows older than 30 days and expired sessions.
- The server rejects any `kdf` outside the floor and ceiling on setup and password change (422), using the constants from `packages/crypto`.
- Request bodies and tokens are never logged; the logger redacts `auth_key`, `token`, `ciphertext`, codes.
- Each secret key has one purpose; none is reused for another HMAC.

**Security model**: one account. Every bearer route resolves `token_hash` to an unrevoked, unexpired session, else 401 with its `code`. CORS allows the web vault (same origin) and the extension origins in `ALLOWED_ORIGINS`. Headers: CSP `default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; style-src 'self'; connect-src 'self' https://api.pwnedpasswords.com; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`, plus HSTS, `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`.

**Configuration required**:
- `SETUP_TOKEN`: one time secret for first run setup (remove after setup).
- `AUTH_HMAC_KEY`: 32 random bytes, HMAC for `auth_key` and `recovery_auth_key`.
- `CODE_HMAC_KEY`: 32 random bytes, HMAC for recovery codes.
- `IP_HASH_KEY`: 32 random bytes, HMAC for IP hashing.
- `PRELOGIN_KEY`: 32 random bytes, for fake prelogin salts.
- `TOTP_ENC_KEY`: 32 random bytes, encrypts the TOTP secret at rest.
- `ALLOWED_ORIGINS`: comma list, the extension origins.
- `DB`: D1 binding.

**Critical test scenarios**:
- Setup, TOTP enroll, login, `PUT` item, `GET /api/sync` from a second device, verifies **AC-1**, **AC-4**, **AC-8**.
- Second setup returns 409; setup without token returns 401, verifies **AC-1**.
- Five wrong logins return 401; the sixth returns 429 with `Retry-After: 60` even with correct credentials; 25 failures spread over many IPs only slow the next attempt, verifies **AC-4**.
- A TOTP code reused within its window is rejected, verifies **AC-4**.
- Two `PUT`s with the same base revision: the second gets 409 and the current row, verifies **AC-9**.
- A purged item appears in sync as `purged: true`; a `since` older than 90 days returns `full_resync`, verifies **AC-11**.
- A revoked token gets `401 revoked`; an expired one gets `401 expired`, verifies **AC-22**.
- Password change revokes every other session; the old `auth_key` fails, verifies **AC-21**.
- A recovery token works once, within 10 minutes, only on `/api/account/password`, verifies **AC-20**.
- Captured request bodies contain no field outside the AC-2 list, verifies **AC-2**, **AC-23**.

## Build plan

1. (slice 1) `apps/server` Hono app, D1 migration for all four tables, redacting logger, security headers, satisfies **AC-2**, **AC-23**.
2. (slice 1) `POST /api/setup`, `/api/auth/prelogin`, `/api/auth/login` (TOTP skipped while not enabled), device tokens with 401 codes, satisfies **AC-1**, **AC-2**.
3. (slice 1) `PUT /api/items/:id` with `If-Match` and `GET /api/sync`, satisfies **AC-8**, **AC-9**.
4. Login limiter and `login_attempt` logging, satisfies **AC-4**.
5. TOTP enroll, confirm, required at login, reuse check, recovery codes, fresh TOTP guard, satisfies **AC-4**.
6. Trash via `PUT`, permanent delete, empty trash, tombstones, daily Cron purge, `full_resync`, satisfies **AC-11**.
7. Devices list and revoke, satisfies **AC-22**.
8. Password change, recover, and recovery token, satisfies **AC-20**, **AC-21**.
