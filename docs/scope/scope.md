# Scope: securepass

Your own zero knowledge password manager: one account (yours), a small sync server on Cloudflare, a web vault, and a browser extension that fills logins. Everything is encrypted on your device before it leaves.

**Build approach:** Tracer Bullet (one real login item travels through every layer first, then each later slice thickens one strand of that working thread).
**Workflow:** GA (after develop: check verify, test, a fresh model check review, then document). The project default level of rigor. `/architect` is the recommended first stop for a feature with a real decision, but skippable when you already know the build. Any feature can carry its own tag (e.g. `· Beta`) to do more or less.

_These are recommendations to keep your build orderly, not requirements. Skip anything that does not fit: if you already know how to build a feature, use `/develop` and skip `/architect`. You decide when a feature is `done`._

Specs live in [docs/specs/0001-securepass-vault/](../specs/0001-securepass-vault/index.md). Each row below that already has a spec is rolled up from that spec's build plan, with slice 1 tasks pulled forward so the thin thread runs first.

## At a glance

| #   | Feature                                 | Phase      | Status      |
| --- | --------------------------------------- | ---------- | ----------- |
| 1   | Stack & architecture                    | Foundation | done        |
| 2   | Coding standards & tooling              | Foundation | done        |
| 3   | Crypto core basics                      | Slice 1    | in-progress |
| 4   | Sync server basics                      | Slice 1    | in-progress |
| 5   | Web vault: setup, unlock, first login   | Slice 1    | in-progress |
| 6   | Extension: unlock and click to fill     | Slice 1    | in-progress |
| 7   | First deploy to Cloudflare              | Slice 1    | planned     |
| 8   | Crypto hardening and recovery kit       | Slice 2    | in-progress |
| 9   | Login protection: limiter and TOTP      | Slice 2    | in-progress |
| 10  | Full item lifecycle                     | Slice 3    | in-progress |
| 11  | Offline queue and conflict copies       | Slice 4    | in-progress |
| 12  | Extension lock, PIN, and popup tools    | Slice 5    | in-progress |
| 13  | Extension save and update prompt        | Slice 5    | in-progress |
| 14  | Devices, password change, recovery flow | Slice 6    | in-progress |
| 15  | Generator and breach check              | Slice 7    | in-progress |
| 16  | Encrypted export                        | Slice 7    | planned     |
| 17  | Independent security review             | Slice 7    | planned     |
| 18  | LastPass CSV import                     | Slice 7    | in-progress |

## Foundations

### 1. Stack & architecture · done

Set up the pnpm workspace so every later slice builds on real structure: shared crypto and shared types packages, the server, the web app, and the extension shell.
**Done when:** the stack is recorded in a spec and the empty workspace installs, builds, and boots locally (server, web, and extension shells each start).
- [x] Decide the stack (spec): `/architect stack & architecture`
- [x] Scaffold from the decision: `/develop stack & architecture`
  - [x] Workspace with `packages/crypto`, `packages/shared`, strict TypeScript
  - [x] `apps/server` Hono shell with Wrangler and a D1 binding
  - [x] `apps/web` Vite shell and `apps/extension` WXT shell boot
- [x] Verify it: `/check verify stack & architecture`
- [x] Test it: `/test stack & architecture`
  Code in `packages/`, `apps/server`, `apps/web`, `apps/extension`.
  [Spec 0001](../specs/0001-securepass-vault/index.md)

### 2. Coding standards & tooling · done

Capture conventions, then install lint, format, and pre commit enforcement from the real scaffolded project. Also record the build approach in root `AGENTS.md`.
**Done when:** root `AGENTS.md` reflects the real stack and build approach, and lint, format, and pre commit run clean.
- [x] Capture conventions and tooling choices: `/audit`
- [x] Install the tooling: `/develop tooling`
- [x] Check it runs clean: `/test`

## Slice 1: the thin thread (this is the walking skeleton)

### 3. Crypto core basics

The shared `packages/crypto` pieces that one login item needs: seal and open with tamper checks, Argon2id key stretching, key splitting, and item sealing.
**Done when:** a login item sealed with a master password opens again, any changed byte or moved item id fails to open, and KDF settings outside the allowed range are refused.
- [x] Design it (spec): `/architect crypto core`
- [x] Build it: `/develop crypto core basics`
  - [x] Envelope `seal`/`open` with version byte and per type prefixes (AC-6)
  - [x] `deriveMasterKey` with `assertKdf` and RFC 9106 vectors (AC-3, AC-5)
  - [x] `splitKeys` with RFC 5869 vectors (AC-2)
  - [x] Vault key wrap, `sealItem`/`openItem`, `ItemPayload` schema (AC-6, AC-7, AC-23)
- [x] Verify it: `/check verify crypto core basics`
- [x] Test it: `/test crypto core basics`
- [x] Review it: `/check review crypto core basics`
- [ ] Document it: `/document crypto core basics`
  [Spec 0001.1](../specs/0001-securepass-vault/0001-crypto-core.md) · code in `packages/crypto`, `packages/shared`

### 4. Sync server basics

The Hono API on Workers and D1 with just enough to create the account, log in, and sync one item.
**Done when:** setup works once with the right `SETUP_TOKEN` and returns 409 after, login returns a device token, and an item can be saved with `If-Match` and read back through `GET /api/sync`. The server never sees plaintext.
- [x] Design it (spec): `/architect sync server`
- [x] Build it: `/develop sync server basics`
  - [x] Hono app, D1 migration for all four tables, redacting logger, security headers (AC-2, AC-23)
  - [x] `POST /api/setup`, prelogin, login, device tokens and 401 codes (AC-1, AC-2)
  - [x] `PUT /api/items/:id` with `If-Match` and `GET /api/sync` (AC-8, AC-9)
- [x] Verify it: `/check verify sync server basics`
- [x] Test it: `/test sync server basics`
- [x] Review it: `/check review sync server basics`
- [ ] Document it: `/document sync server basics`
  [Spec 0001.2](../specs/0001-securepass-vault/0002-sync-server.md) · code in `apps/server`, `packages/shared`

### 5. Web vault: setup, unlock, first login

Setup with a recovery kit, unlock, and a list where you can create one login, backed by the local cache and sync loop.
**Done when:** you can run setup, unlock with the master password in under 2 seconds, create a login, and see it in the list after a sync.
- [x] Design it (spec): `/architect web vault`
- [x] Build it: `/develop web vault first login`
  - [x] Setup (with recovery kit) and Unlock screens (AC-1, AC-5, AC-20)
  - [x] Shared cache module and sync loop (AC-8)
  - [x] Item list and login create (AC-7)
- [x] Verify it: `/check verify web vault first login`
- [x] Test it: `/test web vault first login`
- [ ] Review it: `/check review web vault first login`
- [ ] Document it: `/document web vault first login`
  [Spec 0001.3](../specs/0001-securepass-vault/0003-web-vault.md) · code in `apps/web`, `packages/shared/src/cache`, `packages/shared/src/sync`

### 6. Extension: unlock and click to fill

The WXT extension unlocks with the master password, syncs the shared cache, and fills one login on one site after you click a suggestion.
**Done when:** you unlock in the popup, see the field icon on a matching `https` page, and a click fills the login. It never fills a hidden field, a cross origin frame, or a non matching domain.
- [x] Design it (spec): `/architect browser extension`
- [ ] Build it: `/develop extension click to fill`
  - [ ] Popup unlock and background sync on the shared cache (AC-5, AC-8)
  - [ ] Content script field detection, inline icon, `suggest` and `fill` with all six fill rules (AC-14)
- [ ] Verify it: `/check verify extension click to fill`
- [ ] Test it: `/test extension click to fill`
- [ ] Review it: `/check review extension click to fill`
- [ ] Document it: `/document extension click to fill`
  [Spec 0001.4](../specs/0001-securepass-vault/0004-browser-extension.md)

### 7. First deploy to Cloudflare

Put the thin thread on a real Worker with D1 and one custom domain, so the whole pipe is proven outside your laptop.
**Done when:** the deployed Worker serves the web vault and API from one origin, setup works there, and the extension syncs against it.
- [ ] Build it: `/develop first deploy`
- [ ] Verify it: `/check verify first deploy`
- [ ] Test it: `/test first deploy`
- [ ] Review it: `/check review first deploy`
- [ ] Document it: `/document first deploy`

## Slice 2: Recovery and login protection

### 8. Crypto hardening and recovery kit

Add the checks and keys that guard against a hostile server and a forgotten password: rollback detection, the recovery kit, PIN wrap, and the full tamper test suite.
**Done when:** a server that returns an older item is flagged, a recovery key unwraps the vault, a PIN of 6 or more characters wraps and unwraps, and the tamper, wrong id, and KDF range suite passes with the unlock benchmark.
- [x] Design it (spec): `/architect crypto core`
- [ ] Build it: `/develop crypto hardening`
  - [ ] Rollback check helper (`seq` vs `seen_seq`) (AC-6)
  - [ ] Recovery kit generation and unwrap (AC-20)
  - [ ] PIN wrap and unwrap (AC-13)
  - [ ] Tamper, wrong id, KDF range suite plus unlock benchmark (AC-3, AC-5, AC-6)
- [ ] Verify it: `/check verify crypto hardening`
- [ ] Test it: `/test crypto hardening`
- [ ] Review it: `/check review crypto hardening`
- [ ] Document it: `/document crypto hardening`
  [Spec 0001.1](../specs/0001-securepass-vault/0001-crypto-core.md)

### 9. Login protection: limiter and TOTP

Make server login hard to guess: a per IP limiter, and a TOTP code required at login with recovery codes as backup.
**Done when:** 5 failures from one IP in an hour gives 429 with a doubling `Retry-After`, login needs a TOTP code, codes cannot be reused, and the web vault forces TOTP enrollment.
- [x] Design it (spec): `/architect sync server`
- [ ] Build it: `/develop login protection`
  - [ ] Login limiter and `login_attempt` logging (AC-4)
  - [ ] TOTP enroll, confirm, required at login, reuse check, recovery codes, fresh TOTP guard (AC-4)
  - [ ] Forced TOTP enrollment screen in the web vault (AC-4)
- [ ] Verify it: `/check verify login protection`
- [ ] Test it: `/test login protection`
- [ ] Review it: `/check review login protection`
- [ ] Document it: `/document login protection`
  [Spec 0001.2](../specs/0001-securepass-vault/0002-sync-server.md) · [Spec 0001.3](../specs/0001-securepass-vault/0003-web-vault.md)

## Slice 3: Full item lifecycle

### 10. Full item lifecycle

Thicken items beyond one login: notes and identities, editing, the last 5 passwords per login, and trash with restore and a 30 day purge.
**Done when:** you can create, edit, trash, and restore logins, notes, and identities; each login shows its last 5 previous passwords; a trashed item is purged from the server and every cache after 30 days.
- [x] Design it (spec): `/architect sync server` and `/architect web vault`
- [ ] Build it: `/develop item lifecycle`
  - [ ] Trash via `PUT`, permanent delete, empty trash, tombstones, daily Cron purge, `full_resync` (AC-11)
  - [ ] Notes and identities, edit, password history, trash and restore in the web vault (AC-7, AC-11, AC-12)
- [ ] Verify it: `/check verify item lifecycle`
- [ ] Test it: `/test item lifecycle`
- [ ] Review it: `/check review item lifecycle`
- [ ] Document it: `/document item lifecycle`
  [Spec 0001.2](../specs/0001-securepass-vault/0002-sync-server.md) · [Spec 0001.3](../specs/0001-securepass-vault/0003-web-vault.md)

## Slice 4: Offline and conflicts

### 11. Offline queue and conflict copies

Make the vault work with no network and handle two devices editing the same item, in both the web vault and the extension.
**Done when:** unlock, search, view, and fill work offline from the encrypted cache; edits queue and sync later; the newer edit wins and the losing version is kept as a conflict copy; a revoked device wipes its cache while an expired session keeps it.
- [x] Design it (spec): `/architect web vault` and `/architect browser extension`
- [ ] Build it: `/develop offline and conflicts`
  - [ ] Offline queue, conflict rules, conflict copies, revoked vs expired handling in the web vault (AC-9, AC-10, AC-22)
  - [ ] Offline unlock and fill, revoked vs expired handling in the extension (AC-10, AC-22)
- [ ] Verify it: `/check verify offline and conflicts`
- [ ] Test it: `/test offline and conflicts`
- [ ] Review it: `/check review offline and conflicts`
- [ ] Document it: `/document offline and conflicts`
  [Spec 0001.3](../specs/0001-securepass-vault/0003-web-vault.md) · [Spec 0001.4](../specs/0001-securepass-vault/0004-browser-extension.md)

## Slice 5: Extension daily use

### 12. Extension lock, PIN, and popup tools

Make the extension safe to leave running: it locks itself, unlocks with a PIN, and has search, copy, a generator, and a breach check in the popup.
**Done when:** it locks after 15 minutes idle, on system lock, and on browser close; a PIN of 6 or more characters unlocks within a session and 5 wrong PINs remove it; a copied password clears after 30 seconds.
- [x] Design it (spec): `/architect browser extension`
- [ ] Build it: `/develop extension lock and popup tools`
  - [ ] Activity based lock, system lock, PIN unlock with failure counter (AC-13)
  - [ ] Popup search, copy, offscreen clipboard clear, generator, breach check (AC-16, AC-18, AC-19)
- [ ] Verify it: `/check verify extension lock and popup tools`
- [ ] Test it: `/test extension lock and popup tools`
- [ ] Review it: `/check review extension lock and popup tools`
- [ ] Document it: `/document extension lock and popup tools`
  [Spec 0001.4](../specs/0001-securepass-vault/0004-browser-extension.md)

### 13. Extension save and update prompt

Offer to save or update a login after you submit a form with new or changed credentials, including script driven logins and change password forms.
**Done when:** submitting a new or changed login shows a prompt to save or update, including on script driven forms and change password forms.
- [x] Design it (spec): `/architect browser extension`
- [ ] Build it: `/develop extension save prompt`
  - [ ] Save and update prompt for normal, script driven, and change password forms (AC-15)
- [ ] Verify it: `/check verify extension save prompt`
- [ ] Test it: `/test extension save prompt`
- [ ] Review it: `/check review extension save prompt`
- [ ] Document it: `/document extension save prompt`
  [Spec 0001.4](../specs/0001-securepass-vault/0004-browser-extension.md)

## Slice 6: Account safety

### 14. Devices, password change, recovery flow

Let you see and revoke devices, change the master password, and recover with the recovery kit when the master password is forgotten.
**Done when:** you can list devices and revoke one with a fresh TOTP code; changing the master password rewraps the vault key and signs out other devices; the recovery key plus a TOTP or recovery code sets a new master password and issues a new kit while the old one stops working.
- [x] Design it (spec): `/architect sync server` and `/architect web vault`
- [ ] Build it: `/develop account safety`
  - [ ] Devices list and revoke on the server (AC-22)
  - [ ] Password change, recover, and recovery token on the server (AC-20, AC-21)
  - [ ] Devices screen, change password, and recovery flow in the web vault (AC-19, AC-20, AC-21, AC-22)
- [ ] Verify it: `/check verify account safety`
- [ ] Test it: `/test account safety`
- [ ] Review it: `/check review account safety`
- [ ] Document it: `/document account safety`
  [Spec 0001.2](../specs/0001-securepass-vault/0002-sync-server.md) · [Spec 0001.3](../specs/0001-securepass-vault/0003-web-vault.md)

## Slice 7: Ready for real passwords

### 15. Generator and breach check

Add the password generator and the breach check to the web vault (the extension popup already has them from row 12).
**Done when:** the generator makes random passwords (8 to 128 characters, chosen sets) and passphrases (3 to 12 words) from a cryptographic source, and the breach check sends only the first 5 hex characters of the SHA 1 hash.
- [x] Design it (spec): `/architect web vault`
- [ ] Build it: `/develop generator and breach check`
  - [ ] Generator and breach check screens in the web vault (AC-16, AC-18)
- [ ] Verify it: `/check verify generator and breach check`
- [ ] Test it: `/test generator and breach check`
- [ ] Review it: `/check review generator and breach check`
- [ ] Document it: `/document generator and breach check`
  [Spec 0001.3](../specs/0001-securepass-vault/0003-web-vault.md)

### 16. Encrypted export · needs a decision

An encrypted export, plus an emergency plain CSV export, so you can recover if your Cloudflare account is lost. Your recovery story depends on it.
**Done when:** you can export the whole vault encrypted and restore it on a fresh setup; the plain CSV export is clearly warned and stays on your device.
- [ ] Design it (spec): `/architect encrypted export`

### 17. Independent security review

Get an outside review of `packages/crypto` and the extension fill path before you trust the vault with real passwords. The spec's follow ups call for this.
**Done when:** a reviewer outside this build has read the crypto package and the fill path, and every high finding is fixed or accepted in writing.
- [ ] Prepare the review: `/check review packages/crypto` and `/check review extension fill path`
- [ ] Get an independent reviewer (you arrange this)

### 18. LastPass CSV import

Import a LastPass CSV export locally, so you can move in without the file ever leaving your device. Do this after rows 16 and 17.
**Done when:** a LastPass CSV imports in the browser only, showing how many items were imported and which rows were skipped and why.
- [x] Design it (spec): `/architect web vault`
- [ ] Build it: `/develop lastpass import`
  - [ ] LastPass CSV import with an imported and skipped report (AC-17)
- [ ] Verify it: `/check verify lastpass import`
- [ ] Test it: `/test lastpass import`
- [ ] Review it: `/check review lastpass import`
- [ ] Document it: `/document lastpass import`
  [Spec 0001.3](../specs/0001-securepass-vault/0003-web-vault.md)

## Deferred

Out of scope for the current build pass, kept so the plan stays honest.
- **Firefox build check**: confirm the WXT Firefox target works and note gaps for a later Safari build · `/develop` when you want it
- **Sharing**: X25519 per user keys, folder keys wrapped per member · needs a decision · GA
- **Mobile autofill**: iOS Credential Provider and Android Autofill Service · needs a decision · GA
- **Signed vault manifest**: detect a hostile server hiding items · needs a decision · GA
- **Vault key rotation on password change**: rewrap item keys only · needs a decision · GA

## Legend

**The decision box.** Every feature carries exactly one, the sub task whose label ends with `(spec)`. Its wording varies (`Design it (spec)` normally, `Decide the stack (spec)` on Stack & architecture), so skills locate it by that `(spec)` suffix, never by an exact label. Every other box is an execution box and `/architect` never ticks one.

**Feature lifecycle**: the scope updates as a feature moves; each row is what it shows and who sets it:

| State                        | Set by                                         | The feature shows                                                                                                                                                                                            |
| ---------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `planned` · needs a decision | `/scope`                                       | one box: `Design it (spec): /architect <feature>`                                                                                                                                                            |
| `in-progress` (designed)     | `/architect` at spec capture                   | `Design it` ticked; spec linked; `Build it: /develop <feature>` plus 2 to 5 milestones; the tier's closing boxes (`Verify it` Alpha+, `Test it` Beta+, `Review it` and `Document it` GA)                     |
| `in-progress` (building)     | `/develop`                                     | milestone sub boxes tick one by one; code pointer filled                                                                                                                                                     |
| `in-progress` (verified)     | `/check verify`                                | `Build it` and milestones ticked; `Verify it` ticked                                                                                                                                                         |
| `done`                       | you, when you decide it is; `/sync` reconciles | boxes you ran ticked, skipped ones marked skipped; the tier's last stage (`Prototype` after `/develop`; `Alpha` after `/check verify`; `Beta` and `GA` after `/test`) is the suggested point to call it done |

- **Next step** is the first unticked box (always a command or a tracked milestone).
- **needs a decision** means run `/architect` first; otherwise straight to `/develop` (or `/audit` for standards and tooling). The tag drops once the spec is captured.
- **Atomic build tasks live in the spec's `## Build plan`, not here**: the scope carries only the milestone rollup.
- **Status** `planned`, then `in-progress`, then `done`, plus `existing` (before the workflow) and `dropped` (de scoped, kept for history).
- **Approach tag** beside a heading (e.g. `· Facade`) overrides the project default for that feature; no tag means it inherits.
- **Workflow tier tag** beside a heading (e.g. `· GA`, `· Prototype`) sets that one feature's rigor above or below the project default; no tag inherits the default.
- **Workflow** (header line) is the project default, what runs after `/develop`: **Prototype** is nothing, **Alpha** is `/check verify`, **Beta** is `/check verify` then `/test`, **GA** adds a fresh model `/check review` then `/document`. A feature built on an unratified decision (an `Assumed` spec) stays flagged, but that never blocks `done`.
- **Pointer line** (`Spec <n> · code in <path>`): the spec link added by `/architect`, the code path by `/develop`.
