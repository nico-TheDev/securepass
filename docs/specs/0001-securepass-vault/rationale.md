# 0001. Rationale: securepass vault

## Context

> ⚠️ Premise note: For one user, a self hosted Bitwarden compatible server (such as Vaultwarden) already gives you a reviewed zero knowledge vault, browser extensions, and mobile autofill today. Building your own means you own every mistake in how the crypto pieces fit together, and no one else will catch them. That is a fine choice for learning and control, but treat securepass as untrusted for real passwords until the crypto core and fill path get an independent review (see Follow-up in index.md). This topic also spans several decisions, so it is an umbrella with four child specs; sharing, mobile autofill, and export are separate specs.

You want your own password manager: one account (yours), synced across your browsers, usable offline, and safe even if the server is breached. The server runs on infrastructure you control, reachable on the public internet. There is no team, so anything that needs ongoing operations work is a cost you pay personally.

The design is shaped by an analysis of the LastPass Chrome extension 4.156.0 (static analysis with REA, Evidence `ev_ac074236ff036cd8f1355556c1a6ad2d41c6a9dbc06bb22472f22f7eaeb0a4a4`, plus direct reading of `background-redux-new.js`). Shipped behavior found:

| Finding          | What the code does                                                                                                                                                                      | Risk it creates                                                             |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Key derivation   | PBKDF2 SHA-256, username as salt, default 600,000 iterations (`deriveKeyIterations:6e5`); iteration count comes from the account on the server; 1 iteration falls back to plain SHA-256 | Old or tampered accounts can be stuck on weak stretching                    |
| Login proof      | One more PBKDF2 pass over the vault key, salted with the password                                                                                                                       | Fine in principle; the auth proof is derived from the encryption key itself |
| Item encryption  | `AES-256-CBC`, random IV, format `"!" + iv + "                                                                                                                                          | " + ciphertext`; no MAC seen                                                | No tamper detection |
| Legacy mode      | Data without `!` is decrypted as ECB                                                                                                                                                    | Downgrade path stays alive                                                  |
| AES-GCM          | Present but `enableGCMWrite:false`                                                                                                                                                      | The safer mode is not the default                                           |
| Sharing          | 4096 bit `RSA-OAEP` per user; folder key wrapped per member (`sharekey`) and re-wrapped under the member's vault key (`sharekeyaes`)                                                    | Sound design, worth copying later                                           |
| Private key wrap | Older path used part of the key as the IV; random IV behind a feature flag                                                                                                              | IV tied to the key                                                          |
| Metadata         | Publicly known: vault URLs were stored unencrypted (2022 breach)                                                                                                                        | Not verified in this code; listed as known history                          |

Forces: zero knowledge must hold against a hostile server; the client must work offline; MV3 service workers stop at any time; Cloudflare Workers limit CPU per request; and you will operate this alone.

## Options considered

### Option 1: TypeScript monorepo, Workers + D1, noble + hash-wasm, React SPA, WXT

One language and one shared crypto package across server, web vault, and extension; a thin serverless store.

**Pros**: crypto written once; free hosting for one user; no server to patch; active, audited cipher library.
**Cons**: Workers CPU limits rule out server side slow hashing; D1 is young compared to Postgres; `hash-wasm` has no external audit found.

### Option 2: TypeScript apps, Node + Postgres container on Fly.io

The same clients with a classic container API and managed Postgres.

**Pros**: most familiar operations model; no CPU per request limits; mature database.
**Cons**: no free tier for new accounts and managed Postgres from about $38 a month; you patch the runtime; more to run for one user.

### Option 3: Rust crypto core compiled to WASM, TypeScript apps

The key hierarchy written in Rust (for example on RustCrypto or libsodium) and reused later by native mobile apps.

**Pros**: one core for web and future iOS and Android; strong typing for key handling.
**Cons**: two languages and a WASM build chain from day one; slower to debug for a solo project; mobile is out of scope now.

### Option 4: Self host Vaultwarden and use the official Bitwarden clients

Run the existing server and use the published apps instead of building.

**Pros**: works today, reviewed clients, mobile autofill included.
**Cons**: you learn little and control nothing in the clients; not the product you asked to build.

## Rationale

Option 1 fits the forces best. You operate this alone, so a free managed runtime with nothing to patch beats a container you maintain (Option 2), and one language keeps the security critical code in a single reviewed package (against Option 3's two toolchains). The Workers CPU limit is the main cost, and it is neutralized by design: the server never needs a slow hash because `auth_key` is already Argon2id backed and split by HKDF, so a peppered HMAC is enough. Option 4 is the honest alternative and is named in the premise note; you chose to build.

Each LastPass finding maps to a fix: Argon2id with a client enforced floor replaces server controlled PBKDF2; `XChaCha20-Poly1305` with AD binding replaces unauthenticated CBC and stops item swapping; a version byte with no fallback removes ECB style downgrades; random 24 byte nonces everywhere remove key derived IVs; and all item metadata, URLs included, lives inside the ciphertext. HKDF gives separate encryption and auth keys rather than deriving the login proof from the encryption key. The per item key under a vault key keeps the good part of the LastPass sharing model ready for later.

A cross check on a second model (Sonnet, read only) found 17 gaps and 11 soundness issues in the first draft; all were applied. Its three high severity points shaped the trust model: rollback detection through a sealed `seq`, the web vault trust limit (the extension is the trusted client), and a 6 character PIN minimum with its offline guessing limit stated. You chose to keep the email login and the PIN.

You picked libsodium first; the landscape check found `libsodium-wrappers-sumo` last released in August 2024 and flagged inactive, while `@noble/ciphers` is actively released with an external audit. You then switched to noble plus `hash-wasm`, which this spec records (basis: landscape check, 2026-11-02).

## References

**Project sources**:
- REA static analysis of LastPass 4.156.0 in this session (Evidence `ev_ac074236…`), plus direct reading of `background-redux-new.js`.
- Landscape notes: `docs/.agent-cache/research/vault-stack.md`; tool discovery: `docs/.agent-cache/tool-discovery/vault-stack.md`.

**Practices & standards**:
- OWASP Password Storage Cheat Sheet: Argon2id minimum m=19456 KiB, t=2, p=1 (this spec sets a higher floor).
- RFC 9106 (Argon2), RFC 5869 (HKDF), RFC 6238 (TOTP), RFC 8265 (password normalization, NFC).
- AEAD with associated data binding; never reuse a nonce; no downgrade fallbacks.
- Have I Been Pwned k anonymity range API; Public Suffix List for registrable domains.
- Bitwarden key hierarchy (master key, HKDF stretch, protected symmetric key, per item keys) as a reference design.

**Links** (web verified during the landscape check):
- noble ciphers: https://github.com/paulmillr/noble-ciphers
- noble hashes: https://github.com/paulmillr/noble-hashes
- hash-wasm: https://www.npmjs.com/package/hash-wasm
- libsodium.js: https://github.com/jedisct1/libsodium.js
- OWASP Password Storage Cheat Sheet: https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html
- WXT releases: https://github.com/wxt-dev/wxt/releases
- Plasmo releases: https://github.com/PlasmoHQ/plasmo/releases
- Hono releases: https://github.com/honojs/hono/releases
- Cloudflare D1 pricing: https://developers.cloudflare.com/d1/platform/pricing/
- Fly.io pricing: https://fly.io/pricing
- Bitwarden security white paper: https://bitwarden.com/help/bitwarden-security-white-paper/

## Landscape scan (2026-11-02)

| Item                      | Finding                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------ |
| `@noble/ciphers`          | v2.2.0, active; Cure53 audit on v1.0.0 (Sept 2024); its Argon2 has no external audit |
| `hash-wasm`               | WASM Argon2id, fast; no audit found; latest version unconfirmed (npm returned 403)   |
| `libsodium-wrappers-sumo` | 0.7.15, August 2024, flagged inactive                                                |
| WXT                       | v0.21.5, October 2026, active, MV3 first, Firefox and Safari targets                 |
| Plasmo                    | v0.90.5, slower cadence, maintenance state unconfirmed                               |
| Hono                      | v4.13.16, 1 November 2026 (security release)                                         |
| D1 free tier              | 5M rows read a day, 100k written a day, 5 GB                                         |
| Fly.io                    | trial only for new accounts; managed Postgres from about $38 a month                 |
