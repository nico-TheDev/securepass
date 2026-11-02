# Vault stack research (as of 2026-11-02)

Scope: web-only research, 5 searches and 8 page fetches budget. Dates without a year on GitHub pages are assumed to be 2026 from context; treat as unverified. npm pages returned 403 to the fetcher, so npm facts come from search snippets and are flagged.

## 1. Crypto libraries (browser + MV3 service worker)

### libsodium-wrappers-sumo (libsodium.js)

- Version: 0.7.15 (per search snippet; Snyk lists publish Aug 2024, maintenance marked Inactive).
- Freshness: LOW. No release in about 2 years. Not confirmed on npm directly (403).
- Argon2id: yes. `crypto_pwhash_*` exists only in the sumo build.
- XChaCha20-Poly1305: available (`crypto_aead_xchacha20poly1305_ietf` family and secretstream); not verified against the API reference.
- MV3 service worker: WASM is loaded from a script/ArrayBuffer; MV3 disallows remote code, so bundle the wasm locally. Not verified for the wrapper build.
- Verdict: works, but stale. Use only if you need the exact libsodium primitives. Heavier than noble.
- URLs: https://www.npmjs.com/package/libsodium-wrappers-sumo (403 to fetcher; check manually), https://github.com/jedisct1/libsodium.js

### @noble/hashes + @noble/ciphers (Paul Miller)

- @noble/ciphers: v2.2.0 (search snippet says April 2026; another source says March 2026). XChaCha20-Poly1305 at `@noble/ciphers/chacha.js`.
- @noble/hashes: argon2id exported from `@noble/hashes/argon2.js`.
- Freshness: HIGH. Actively maintained; pure JS, no WASM, works in MV3 service workers.
- Audit: @noble/ciphers v1.0.0 external audit by Cure53, Sept 2024 (per docs). v2.2.0 self-audited in 2026 (LLM-assisted self-audit noted). Maintainer's page says 7 external audits total, the latest (Aug 2026) covers curves only.
- Argon2: one source says `argon2` in @noble/hashes is not externally audited. Treat argon2 as unaudited unless you confirm in the repo's audit notes.
- Caveat: Argon2 in pure JS is slow in browsers. Benchmark before picking params.
- URLs: https://github.com/paulmillr/noble-ciphers , https://github.com/paulmillr/noble-hashes , https://paulmillr.com/noble/

### hash-wasm

- Version: 4.x line (4.10.0 cited in a README benchmark; exact latest not confirmed). Check `npm view hash-wasm version`.
- Freshness: MEDIUM-HIGH (4.x line recent per README CDN tags).
- Argon2id: yes (Argon2d/i/id, v1.3 per Deno listing). WASM-based, faster than pure JS.
- MV3: WASM must be packaged locally (extension CSP blocks remote WASM and `wasm-unsafe-eval` is needed for WASM compile in MV3 extension pages/service workers; verify in your manifest CSP).
- Audit: none found.
- URL: https://www.npmjs.com/package/hash-wasm , https://github.com/Daninet/hash-wasm

### Recommendation

- Primary: `@noble/ciphers` (XChaCha20-Poly1305, most recent, pure JS, MV3-safe) plus Argon2id from `hash-wasm` for speed, or `@noble/hashes/argon2` if you accept pure-JS speed and unaudited argon2 status.
- Alternative: libsodium-wrappers-sumo if you want one well-known audited-in-practice library, accepting staleness.

## 2. OWASP Password Storage Cheat Sheet, Argon2id minimums

- Minimum: m=19456 KiB (19 MiB), t=2, p=1.
- Alternatives (same strength, trade CPU vs RAM): m=47104 (46 MiB), t=1, p=1; m=12288, t=3, p=1; m=9216, t=4, p=1; m=7168, t=5, p=1.
- Freshness: page shows no "last updated" date. Treat as current as of fetch, not dated.
- For a vault with a web and extension client: consider higher than minimum (e.g., m=64 MiB, t=3, p=1) and benchmark on low-end mobile. Derive a per-account salt and store params in the vault header.
- URL: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html

## 3. Extension frameworks: WXT vs Plasmo

### WXT (wxt-dev/wxt)

- Latest: v0.21.5 released 26 Oct (previous wxt release v0.21.4, 11 Aug). Active.
- MV3: first-class; per-part dev reload for MV3.
- Firefox and Safari: stated support in 2026 comparison posts (secondary source). Firefox build targets are documented; Safari requires Xcode wrapper (Safari Web Extension converter), same for any framework.
- Dev: opens a browser with the extension installed during dev.
- URLs: https://github.com/wxt-dev/wxt/releases , https://wxt.dev/guide/resources/compare

### Plasmo (PlasmoHQ/plasmo)

- Latest: v0.90.5 released 17 May; previous v0.90.2 released 09 Feb (year not shown; likely 2026). Release cadence has slowed (3 months gap shown).
- WXT's comparison page (competitor docs) says Plasmo "appears to be in maintenance mode"; footnote placement ambiguous. Not confirmed by a primary source.
- React-first; largest content library.
- Firefox and Safari: little evidence found. Not verified.
- URL: https://github.com/PlasmoHQ/plasmo/releases

### Recommendation

- WXT for a new project (active, framework-agnostic, Firefox/Safari support stated). Plasmo only if you want React-first conveniences and accept slower cadence.

## 4. Sync backend: Hono on Cloudflare Workers + D1 vs Node/Postgres on Fly.io

### Hono

- Latest: v4.13.16 (01 Nov, security release; previous v4.13.15 same day). Very active. Security release urges upgrade for path-scoped `mount()`, wildcard middleware, `validator('form')`, `css`, `csrf()`. Pin and update.
- URL: https://github.com/honojs/hono/releases

### Cloudflare Workers + D1 (recommended for a single-user sync server)

- Free tier: 5M rows read/day, 100k rows written/day, 5 GB total storage, 10 databases. Per-DB limit on D1 limits page (not checked).
- Paid (Workers Paid): 25B rows read/month included, 50M written/month included, 5 GB included then $0.75/GB-month, $0.10 per extra DB/month.
- Fit: a single user's encrypted blobs fit easily in free tier. Store ciphertext only; server never sees keys.
- URL: https://developers.cloudflare.com/d1/platform/pricing/

### Node + Postgres on Fly.io

- No free allowance for new accounts (official blog and pricing page; some third-party sites still show an old free plan, treat as outdated). New orgs get a trial: up to 2 hours Machine runtime or 7 days, no card.
- Managed Postgres from $38/month (Basic, 1 GB RAM). Volumes ~ $0.15/GB-month (third-party figure).
- Fit: works, but costs money from day one and needs more ops.
- URL: https://fly.io/pricing (check directly; see https://fly.io/blog/free-postgres.md for the policy change)

### Recommendation

- Hono on Workers + D1 for a single-user zero-knowledge sync. Revisit only if you need long-running jobs or Postgres features.

## 5. Bitwarden reference key hierarchy (security whitepaper)

- One line: master password -> PBKDF2-SHA256 (default 600k iterations, salted with email; Argon2id optional) -> 256-bit Master Key -> HKDF -> 512-bit Stretched Master Key -> decrypts Protected Symmetric Key -> User Symmetric Key -> encrypts each item's 64-byte cipher key (AES-256-CBC + HMAC).
- Freshness: latest changelog entry 9 Oct 2025 (page is dated; not checked for a newer whitepaper).
- URL: https://bitwarden.com/help/bitwarden-security-white-paper/

Design notes for you: use a per-item key wrapped by an account key, and wrap the account key with a key derived from the master password (Argon2id). Prefer AEAD (XChaCha20-Poly1305) over AES-CBC+HMAC.

## Open items

- Confirm libsodium-wrappers-sumo version and date on npm directly (403 to fetcher).
- Confirm hash-wasm latest version (`npm view hash-wasm version`).
- Confirm Plasmo's year on the release dates and its maintenance state with the maintainers.
- Verify the @noble/ciphers audit month (March vs April 2026 conflict).
