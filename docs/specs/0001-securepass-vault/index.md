# 0001. Build securepass as a zero knowledge vault on a TypeScript monorepo

**Date**: 2026-11-02
**Status**: Accepted

## Summary

securepass is your own password manager: one account (yours), a small sync server you host on Cloudflare, a web vault, and a browser extension that fills logins. Everything is encrypted on your device before it leaves, so the server only ever stores scrambled data plus ids and timestamps (this is what "zero knowledge" means). The design keeps what LastPass got right (keys derived from your password, per folder keys for sharing later) and fixes what we found in its shipped code: weak and server controlled key stretching, encryption without tamper checks, old fallback modes, and unencrypted URLs. Mobile autofill and sharing come later and are not built here.

## Rationale

Reasoning, options and the LastPass findings: see [rationale.md](rationale.md).

## Structure

| Child spec                                             | What it is                                                                                       | Decision it supports                                         |
| ------------------------------------------------------ | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------ |
| [0001-crypto-core.md](0001-crypto-core.md)             | Shared `packages/crypto`: key hierarchy, Argon2id, HKDF, envelope format, recovery key, PIN wrap | How secrets are derived, encrypted and checked for tampering |
| [0002-sync-server.md](0002-sync-server.md)             | Hono API on Cloudflare Workers + D1: setup, login, TOTP, devices, item sync, trash purge         | What the server stores and how devices sync                  |
| [0003-web-vault.md](0003-web-vault.md)                 | React + Vite single page app: unlock, items, offline cache, import, generator, breach check      | Where you manage the vault                                   |
| [0004-browser-extension.md](0004-browser-extension.md) | WXT Manifest V3 extension: lock model, click to fill, save prompt, clipboard                     | How passwords get used everywhere on desktop                 |

## Requirements

**User stories**:
- As the only user, I want my passwords encrypted on my device so that a breach of the server reveals nothing useful.
- As the only user, I want my vault on every browser I use so that I can fill logins anywhere, even offline.
- As the only user, I want a recovery kit so that forgetting my master password does not lose everything.

**Acceptance criteria** (the contract for every child spec):
- **AC-1**: First run setup creates the single account only when the request carries the correct `SETUP_TOKEN`; any later setup call returns 409.
- **AC-2**: The server never receives the master password, master key, encryption key, vault key, item keys, or any plaintext item field. Every request body field is one of: ciphertext, the account email, a client made id (`account_id`, item id), a revision, the `trashed` flag, a KDF parameter or salt, an auth proof (`auth_key`, `recovery_auth_key`, recovery token), a TOTP or recovery code, or a device name.
- **AC-3**: The client accepts only `argon2id` with memory between 65536 KiB and 1 GiB, 3 to 10 passes, and 1 to 4 lanes, and never accepts settings lower than the ones it last used successfully. Anything else stops unlock with an error. Changed KDF settings or salt make unlock fail rather than weaken it.
- **AC-4**: Server login needs the derived auth key plus a TOTP code (or a one time recovery code); TOTP codes cannot be reused. A wrong value returns 401. After 5 failures from one IP within an hour, that IP gets 429 with `Retry-After` doubling from 1 minute up to 60 minutes, even for correct credentials. Failures across many IPs only slow attempts and never lock you out.
- **AC-5**: The correct master password unlocks the vault in under 2 seconds on a recent laptop. A wrong password fails on the vault key tamper check, with no server call needed when a local cache exists.
- **AC-6**: Changing any byte of a stored ciphertext, or moving a ciphertext to a different item id, makes decryption fail. The item shows as damaged, never as garbled data, and never falls back to another mode. A server that sends back an older version of an item than the device has seen is flagged and not applied.
- **AC-7**: You can create, edit, trash and restore logins, secure notes, and identities in the web vault and the extension.
- **AC-8**: A change saved on one device appears on another after its next sync (on open, after every write, and every 5 minutes while unlocked).
- **AC-9**: When two devices edit the same item before syncing, the newer edit wins (rules in 0003, including clock skew, ties, and edit vs trash), and the whole losing version is kept as a conflict copy on the item. No edit is silently lost.
- **AC-10**: With no network, unlock, search, view, and autofill work from the encrypted local cache. Edits queue and sync once back online.
- **AC-11**: Trashing an item hides it on all devices; it can be restored for 30 days, then it is purged from the server and every cache.
- **AC-12**: Each login keeps its last 5 previous passwords with the date each was replaced, visible in the item view.
- **AC-13**: The extension locks after 15 minutes without extension activity, when the system locks, and when the browser closes. Within a browser session you can unlock again with a PIN of at least 6 characters; 5 wrong PINs remove the PIN unlock and require the master password.
- **AC-14**: The extension shows an icon in login fields and fills only after you click a suggestion. It fills only on `https` pages whose registrable domain matches the saved URL (or the exact host when the item says so), and never into hidden fields or a frame from a different origin than the top page.
- **AC-15**: After you submit a login form with new or changed credentials, the extension offers to save or update the item.
- **AC-16**: The generator makes random passwords (length 8 to 128, chosen character sets) and passphrases (3 to 12 words) using a cryptographic random source.
- **AC-17**: A LastPass CSV export imports locally (the file never leaves the device) and shows how many items were imported and which rows were skipped and why.
- **AC-18**: The breach check sends only the first 5 hex characters of the password's SHA-1 hash to Have I Been Pwned and reports the match count.
- **AC-19**: A copied password is cleared from the clipboard after 30 seconds if the clipboard still holds it.
- **AC-20**: Setup produces a recovery kit. Using the recovery key plus a TOTP or recovery code lets you set a new master password and issues a new recovery kit; the old kit stops working.
- **AC-21**: Changing the master password rewraps the vault key, rotates the auth key, and signs out every other device. Item ciphertexts do not change.
- **AC-22**: You can list devices with last use and revoke one (a fresh TOTP code is needed). A revoked device gets `401 revoked` on its next request, locks, and wipes its local cache. A device whose session merely expired keeps its cache and queued edits and asks you to log in again.
- **AC-23**: Per item, the server stores only id, revision, created and updated time, size, and trash or purge state. Names, URLs, usernames, item type, and folders are only inside ciphertext.

## Trust model

- **Protected against**: a stolen database or a curious server operator (sees only ciphertext and settings); a hostile server editing, swapping, or rolling back items (tamper checks, AD binding, `seq`); weak or swapped KDF settings (floor, ceiling, pinning, AD binding); credential guessing (Argon2id, HMAC key, limiter, TOTP).
- **Not protected against in v1**: a hostile server hiding items entirely; a hostile server shipping a modified web vault page that captures the master password (the extension is the trusted client, because its code is bundled at install; unlock the web vault only on trusted devices); malware on your device; offline PIN guessing by someone who can read the browser's extension memory.

## Decision

**Chosen option**: Option 1: TypeScript monorepo, shared crypto package, Hono on Cloudflare Workers + D1, React + Vite web vault, WXT extension.

Build securepass as a pnpm workspace where one audited crypto package is used by the server, web vault, and extension, and the server is a thin store of ciphertext.

**Implementation skills**: none installed yet (see Follow-up).

## Proposed stack

| Layer            | Choice                                                                                                                 | Reason                                                                  |
| ---------------- | ---------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Architecture     | Monolith: one Worker serves the API and the web vault assets, same origin                                              | One user, one deployable, no CORS between web vault and API             |
| Language         | TypeScript (strict) everywhere                                                                                         | Crypto written once and shared by every app                             |
| Repo             | pnpm workspace: `packages/crypto`, `packages/shared` (types, zod schemas), `apps/server`, `apps/web`, `apps/extension` | Shared types keep the API contract in one place                         |
| Symmetric crypto | `@noble/ciphers` (`xchacha20poly1305`), later its X25519 for sharing                                                   | Audited, actively released, pure JS so it runs in an MV3 service worker |
| Password hashing | `hash-wasm` Argon2id                                                                                                   | Fast WASM Argon2id keeps unlock under 2 seconds at 64 MiB               |
| Key splitting    | HKDF SHA-256 via WebCrypto                                                                                             | Built into every runtime, no extra dependency                           |
| Server framework | Hono on Cloudflare Workers                                                                                             | Small, typed, made for Workers                                          |
| Database         | Cloudflare D1 (SQLite) with Drizzle schema and wrangler migrations                                                     | Relational, free tier fits one user, migrations tracked in git          |
| Validation       | zod schemas in `packages/shared`                                                                                       | Same validation on client and server                                    |
| Auth             | Built in: HKDF auth key + server HMAC, TOTP, opaque device tokens                                                      | No hosted auth service can take a derived key instead of a password     |
| Scheduled jobs   | Workers Cron Trigger, daily                                                                                            | Trash purge and attempt log cleanup, no queue needed                    |
| Web vault        | React + Vite static SPA                                                                                                | No server rendering, so secrets never touch a server render path        |
| Extension        | WXT (Manifest V3), Chrome first, Firefox and Safari builds later                                                       | One codebase for every browser                                          |
| Local storage    | IndexedDB (via `idb`) for ciphertext cache; `chrome.storage.session` for the unlocked key in the extension             | Ciphertext only on disk; key only in memory                             |
| Domain matching  | `tldts` (Public Suffix List)                                                                                           | Correct registrable domain logic is not hand written                    |
| Testing          | Vitest (unit, crypto test vectors), Playwright (web vault and extension end to end)                                    | One runner per kind of test                                             |
| Hosting          | Cloudflare Workers + static assets, one custom domain                                                                  | Free tier, no server to patch                                           |
| Observability    | Workers Logs with a redacting logger; no request bodies logged                                                         | Enough for one user; nothing secret leaves the logs                     |

## Cross child contract

- **Key hierarchy and envelope format** are defined only in [0001-crypto-core.md](0001-crypto-core.md). Every app calls `packages/crypto`; no app imports `@noble/ciphers` or `hash-wasm` directly.
- **API contract** lives in `packages/shared` as zod schemas and is defined in [0002-sync-server.md](0002-sync-server.md). Clients and server import the same schemas.
- **Item payload** (the plaintext inside an item ciphertext) is the `ItemPayload` type in `packages/shared`, versioned by its `v` field, defined in [0001-crypto-core.md](0001-crypto-core.md).
- **Local cache shape** (IndexedDB stores `items`, `meta`, `pending_ops`) is shared by the web vault and extension through `packages/shared/cache`, defined in [0003-web-vault.md](0003-web-vault.md).
- **Slice order (build approach)**: no build approach is recorded for this project, so this assumes Tracer Bullet (a thin path through every layer first, then thicken). Slice 1 is one login item end to end: crypto core basics, setup and login without TOTP, `PUT` and `GET /api/sync`, a web vault list, extension fill on one site. Each child's build plan marks which tasks belong to slice 1.

## Consequences

**Positive**:
- A server breach exposes only ciphertext, a salt, KDF parameters, and an HMAC of a high entropy auth key.
- Tamper checks on every ciphertext and AD binding to item ids stop a hostile server from swapping or editing items unnoticed.
- Per item keys under a vault key make password changes cheap and make sharing (later) a key wrapping job, not a re-encryption job.

**Negative / tradeoffs**:
- You own the security of custom crypto glue. Even with audited primitives, a mistake in the composition is yours to find. An external review before you trust it with real passwords is strongly advised.
- The `hash-wasm` Argon2id has no external audit found; it is checked against RFC 9106 test vectors instead.
- MV3 service workers stop when idle, so the extension keeps the unlocked key in `chrome.storage.session`, which is memory only but readable by any page of the extension.
- The web vault is delivered by the server it is meant to distrust; a compromised server could change it. The trust model names this, and the extension is the trusted client.
- Changing the master password rewraps the same vault key, so an old wrapped key plus the old password still opens the vault; rotating the vault key is a follow up.
- A hostile server can hide items without detection in v1.
- Forgetting the master password AND losing the recovery kit loses the vault for good; there is no back door by design.
- A single Cloudflare account is a single point of failure; local caches keep you working, but recovery from an account loss needs an export.
- No mobile autofill yet; on phones you only have the web vault.

**Neutral**:
- Cloudflare Workers have CPU limits per request, so the server never runs Argon2id; it only does HMAC and SQL.
- TOTP secrets are encrypted with a server key, not zero knowledge, because the server must read them to check codes.

## Follow-up

- [ ] Get an independent security review of `packages/crypto` and the extension fill path before importing real passwords.
- [ ] Design sharing (X25519 per user keys, folder keys wrapped per member) as its own spec.
- [ ] Design mobile autofill (iOS Credential Provider, Android Autofill Service) as its own spec.
- [ ] Consider a signed vault manifest (an HMAC under the vault key over item ids and `seq`) so hidden items are detected.
- [ ] Consider optional vault key rotation on password change (rewrap item keys only, payloads untouched).
- [ ] Add an encrypted export (and an emergency plaintext CSV export) as its own spec, since the recovery story depends on it.
- [ ] Record the build approach (Tracer Bullet assumed) in `AGENTS.md` once `/audit` creates it.
- [ ] Connect the Cloudflare MCP server (live Workers, D1 and logs access) and the Playwright MCP server (`@playwright/mcp`, drives a real browser for the end to end checks) in your MCP settings; record them on the `MCP servers:` line of `AGENTS.md` when `/audit` creates it.
- [ ] Agent Skills: none chosen yet. Candidates found: `cloudflare/skills@workers-best-practices`, `cloudflare/skills@wrangler`, `antfu/skills@vite`, `antfu/skills@vitest`, `antfu/skills@pnpm`, `microsoft/playwright-cli@playwright-cli`, `yusukebe/hono-skill@hono`, community `tenequm/skills@chrome-extension-wxt` (unverified).
- [ ] Confirm current versions of `hash-wasm`, `tldts`, `idb`, `otpauth`, and Drizzle's D1 support at build time (the landscape check could not confirm these).
