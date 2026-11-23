# Handoff: finishing the securepass scope

Written 2026-11-11. This picks up from a session that was building every remaining buildable row of [docs/scope/scope.md](scope/scope.md). Read this first, then the scope and the four specs in [docs/specs/0001-securepass-vault/](specs/0001-securepass-vault/index.md).

## Where things stand

The server, the shared client logic, and the web vault are built, tested, and committed. The browser extension has not been started. The scope file has **not** been updated yet: none of the boxes for the work below are ticked.

| Scope row | Server | Web vault | Extension |
| --- | --- | --- | --- |
| 6. Extension: unlock and click to fill | n/a | n/a | not started |
| 7. First deploy | config ready, not deployed | n/a | n/a |
| 8. Crypto hardening and recovery kit | done (in `packages/crypto`) | | |
| 9. Login protection: limiter and TOTP | done | done | n/a |
| 10. Full item lifecycle | done | done | n/a |
| 11. Offline queue and conflict copies | n/a | done | not started |
| 12. Extension lock, PIN, popup tools | n/a | n/a | not started (PIN wrap exists in crypto) |
| 13. Extension save and update prompt | n/a | n/a | not started |
| 14. Devices, password change, recovery | done | done | n/a |
| 15. Generator and breach check | n/a | done | n/a |
| 16. Encrypted export | not built, needs `/architect` first | | |
| 17. Independent security review | needs an outside reviewer | | |
| 18. LastPass CSV import | n/a | done | n/a |

## Git state

Current branch is `feat/web-vault-full`. The working tree is clean apart from this file. Nothing has been pushed (the repo has no remote). Branches are stacked, each on top of the one before:

1. `feat/web-vault-first-login`: `4406d7d` committed the web test suite that was sitting uncommitted.
2. `feat/crypto-hardening`: `29aae0a`.
3. `feat/server-protection-lifecycle`: `b7aa5f5`.
4. `feat/client-vault-core`: `7f078c5`.
5. `feat/web-vault-full`: `2188ef3`.

`main` is still at `6d2531a`, far behind. Nothing has been merged into it.

## What was built

**`packages/crypto`** (row 8): `isRollback`, `nextSeq`, `parseRecoveryKey`, `unwrapVaultKeyRecovery`, `wrapWithPin`, `unwrapWithPin` (6 character minimum), Base32 helpers, and `hardening.test.ts`.

**`packages/shared`**: zod schemas for every new endpoint in `api.ts`. The cache gained `queueLatestOp` (one queued write per item), `rewritePending`, `readItem`, and two optional `meta` fields, `flagged_rollbacks` and `totp_enrolled`. `syncOnce` now takes hooks (`resolveConflict`, `acceptRow`) and handles `full_resync`.

**`packages/vault`** (new package, `@securepass/vault`): client logic shared by the web vault and, later, the extension. API client, unlock, sign in, sign in again, password change, recovery, item create and edit, password history, conflict rules, `syncVault` (the sync round with conflict and rollback handling), search and filters, generator with the bundled EFF wordlist, breach check, URL normalizing and matching with `tldts`, and the LastPass import with `papaparse`. The extension should build on this package rather than repeat any of it.

**`apps/server`** (rows 9, 10, 14, and the code half of 7): login limiter, TOTP enroll and confirm, TOTP and recovery codes at login, fresh TOTP guard, `/api/auth/recover`, `/api/account/password`, `/api/auth/logout`, `/api/devices`, permanent delete, empty trash, `full_resync`, and the daily Cron purge. The Worker now serves the web vault build through an `ASSETS` binding so every file gets the security headers. API tests live in `apps/server/test/` and run against a real local Worker and D1.

**`apps/web`**: sign in with a code, forced TOTP enrollment with a QR code, recovery flow, sign in again dialog, the vault shell with navigation, search, folders, favorites and trash, item form and detail for all three types, password history, conflict copies, rollback notice, generator, breach check, import, devices, and settings.

## Verification so far

- `pnpm typecheck`: clean.
- Tests: crypto 32, server 40, vault package 39, web 117. All pass. The server suite takes about 40 seconds.
- `pnpm check` reports one error that existed before this work: table formatting in `docs/specs/0001-securepass-vault/0001-crypto-core.md`. It was left alone because the spec is not this work's to edit.
- A browser run of the real web vault against a local Worker passed 40 checks: setup, recovery kit, forced enrollment, unlock in 263 ms, no plaintext in requests or browser storage, edit and history, notes and identities, a second device, trash, offline edits, a two device conflict, generator, breach check, import, permanent delete, device revoke and wipe.

**Not yet confirmed in the browser.** The run was interrupted before these finished, so treat them as unverified in a real browser even though their server and unit tests pass: an expired session keeping its queue and signing in again, changing the master password, recovery with the kit on a fresh device, the old kit failing, and a second setup being refused. The last attempt timed out waiting for the item list somewhere in that stretch. The cause is unknown: it may be the check script or a real bug.

The browser check script is not in the repo. It lives in the session scratchpad at `/private/tmp/claude-501/-Users-norbertoignacio-Documents-Projects-securepass/8b93635d-9fe4-406a-b021-2d235721479a/scratchpad/e2e/web.cjs` and may not survive. It expects a Worker on port 8799 with the test secrets shown in `apps/server/test/global-setup.ts`.

A local `wrangler dev` on port 8799 was started in the background for that run and may still be running. It uses a scratch database, not the project's `.wrangler` state. Stop it if it is still up.

## Choices made that the specs did not spell out

Each of these is worth a look, and the first two change the API contract in spec 0002.

1. `POST /api/auth/recover` also returns `account_id`. The client needs it to open the recovery wrap on a device with no cache, and the spec named no source for it.
2. The recovery form of `POST /api/account/password` takes `device_name` and returns the 10 new `recovery_codes`.
3. Limiter: refused (429) requests are logged but do not count as failures, so waiting out `Retry-After` always works. Each further failed check doubles the wait. The spec's "7th attempt gets 120" example only holds if the 7th is a checked failure.
4. Prelogin is refused for a blocked IP, and only an unknown email counts as a failure.
5. `full_resync`: the purge job keeps the newest expired tombstone as a marker, and the flag is true when `since` is below that marker. This avoided a schema change.
6. TOTP is implemented with WebCrypto, with no `otpauth` dependency.
7. The web vault learns whether enrollment is owed by calling `POST /api/account/totp` and treating 409 as "already on". No new endpoint was added.
8. Permanent delete and empty trash are online only, because they need a live TOTP code and cannot be queued.
9. `packages/vault` is a new package. It is not yet listed in root `AGENTS.md` under context files.

## What is left, in order

1. **Finish the web browser check** for the unverified flows above, and fix whatever caused the timeout.
2. **Build the extension** (rows 6, 12, 13, and the extension half of 11) per spec 0004. `apps/extension` is still the WXT starter template. Plan that was in mind:
   - Background service worker: owns the cache, sync through `syncVault`, decrypting, matching with `matchSavedUrl`, all six fill rules, the lock alarm, save prompts. Vault key in `chrome.storage.session`.
   - Popup: runs Argon2id for unlock and PIN, search, copy, generator, breach check, set PIN.
   - Content script: field detection, inline icon, suggestion list in a closed shadow root, visibility checks, submit reporting.
   - Offscreen document for the clipboard.
   - Open points the spec leaves to the build: how the server URL reaches the extension (a build time variable was the plan, since host permissions need it), and where "most recently used" is stored (extension local storage was the plan).
   - AC-7 says items can be managed "in the web vault and the extension", but spec 0004 only gives the extension save and update. This gap should be raised, not guessed at.
3. **Update the scope and spec build plans**: tick the `Build it` boxes and milestones that landed, and fill the code pointer lines. Do not tick `Verify it`, `Test it`, `Review it`, or `Document it` without running those steps.
4. **Add `packages/vault` to root `AGENTS.md`** (through `/sync` or `/audit`), and fix the stale "oxlint" line in `apps/web/AGENTS.md`.
5. **Row 7, deploy**: needs the owner's Cloudflare account. Create the D1 database and put its id in `apps/server/wrangler.jsonc`, set the six secrets, apply the migration, deploy, attach a domain. Confirm before doing any of it.
6. **Row 16** needs `/architect encrypted export`. **Row 17** needs an outside reviewer.

## Commands

```bash
pnpm install
pnpm typecheck
pnpm test                               # all workspaces; the server suite starts a local Worker
pnpm --filter @securepass/server dev    # builds the web vault first, then serves both on 8787
pnpm --filter @securepass/web dev       # Vite dev server, proxies /api to 8787
```
