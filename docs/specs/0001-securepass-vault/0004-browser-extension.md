# 0001.4 Browser extension: WXT, Manifest V3, click to fill

## Summary

The extension is how you use your passwords on any site, and it is the client you can trust most, because its code is bundled when you install it rather than served by the server. It keeps the unlocked key only in browser memory, locks itself when idle or when the browser closes, and fills a login only after you really click it, only on a secure page of the right site. Web pages never see your vault, only the one login you picked.

## Decision

A WXT Manifest V3 extension, Chrome first. The background service worker owns keys, decryption, and matching; content scripts only find fields, show the icon, check what the page shows, and receive one credential after a genuine click. The unlocked vault key is kept in `chrome.storage.session` (memory only, cleared when the browser closes), left at its default access level (extension pages only; never `TRUSTED_AND_UNTRUSTED_CONTEXTS`), because MV3 service workers stop when idle and would otherwise lose it. Short rationale: the only MV3 safe place that survives worker restarts without touching disk. Runner up: an offscreen document holding the key (more moving parts, same exposure).

## Feature design

**Parts**:
- **Background (service worker)**: lock timer, sync loop (shared module from 0003), decrypt, match, fill decisions, save prompts, clipboard clear alarm.
- **Popup**: unlock (master password or PIN; Argon2id runs here, not in the worker), search, item list, copy, open web vault, generator, settings (set PIN).
- **Offscreen document**: clipboard read and write.
- **Content script** (all `https` frames): detect username and password fields, show the inline icon, render the suggestion list in a closed shadow root, run the visibility checks, report submits.

**Messages** (content script to background; the background reads origin and frame only from `sender`, never from the payload):

| Message     | Payload                                 | Reply                                                        |
| ----------- | --------------------------------------- | ------------------------------------------------------------ |
| `suggest`   | none                                    | up to 10 `{ item_id, name, username }` matches, no passwords |
| `fill`      | `item_id`, `field_ids`                  | `{ username, password }` only if every fill rule passes      |
| `submitted` | `{ username, password, password_new? }` | none; background decides save or update                      |

**Fill rules** (all must hold):
1. **Click** (content script): the suggestion was chosen by an `event.isTrusted` click or Enter key in the shadow root; only then is `fill` sent.
2. **Visible** (content script, right before sending `fill` and again before writing values): each target field has a non zero box, is not `display:none`, `visibility:hidden`, or `opacity` below 0.1, and `document.elementFromPoint` at its center returns the field or a descendant.
3. **Unlocked** (background): `vault_key` is present.
4. **Secure** (background): `sender.origin` is `https`.
5. **Same origin as top** (background): `sender.origin` equals the origin of `sender.tab.url` (the top page); the background also confirms the frame URL with `chrome.webNavigation.getFrame`.
6. **Match** (background): using `tldts` with `allowPrivateDomains: true` (so `alice.github.io` and `bob.github.io` are different sites), the registrable domain of `sender.origin` equals that of an item URL with `match: "domain"`, or the exact host equals one with `match: "host"`. IP addresses and `localhost` only ever match by exact host and port. A saved URL with an explicit port matches only that port.

Matches are ordered: exact host first, then most recently used, then name; at most 10 shown.

**URL normalization on save**: lowercase scheme and host, drop default ports, keep the path, drop query and fragment. URLs saved without a scheme get `https://`.

**Lock**: the extension tracks the time of its last activity (popup open, suggestion shown, fill, save). It locks when that time is 15 minutes old (checked by a 1 minute `chrome.alarms` timer), when the system reports `locked` via `chrome.idle`, and when the browser closes (`storage.session` is cleared then). Lock removes `vault_key` and the decrypted index.

**PIN**: optional, set in settings after a master password unlock; minimum 6 characters, letters allowed. `pin_wrapped_vault_key`, `pin_salt`, and a `pin_failures` counter are stored in `chrome.storage.session`. PIN unlock runs Argon2id in the popup. After 5 failures the PIN wrap and counter are deleted, so only the master password works until you set a PIN again. Known limit: someone who can read this browser profile's extension memory could guess the PIN offline without the counter; that is why the minimum is 6 characters and why the PIN never survives a browser restart.

**Save prompt**: triggered by a form `submit`, or, for script driven logins with no submit, by a password field losing its value followed by navigation within 5 seconds. A form with two or more password fields is treated as a change password form (the last filled field is the new password). The background then:
- no item matches the registrable domain and username → shows "Save login?" with name defaulting to the host;
- one matches with a different password → "Update password?" (the old one goes to `password_history`);
- several match the username → asks which one to update;
- the vault is locked → keeps the captured values in background memory for 2 minutes and shows "Unlock to save"; nothing is written without your confirm.
  Nothing is ever saved from a page that fails rules 4 and 5. New items get a client UUID per 0001.

**Clipboard**: copy from the popup writes through the offscreen document (reason `CLIPBOARD`); a 30 second alarm reads the clipboard there and clears it only if it still holds the copied value.

**Permissions**: `storage`, `alarms`, `idle`, `offscreen`, `clipboardWrite`, `clipboardRead`, `webNavigation`, `activeTab`; content script on `https://*/*`; host permissions for the server origin and `https://api.pwnedpasswords.com` only.

**Device identity**: on first launch the extension makes a `device_id` (UUID v4) in `chrome.storage.local` and logs in as its own device session, separate from the web vault.

**Value sourcing**:

| Action        | Value         | Source                                                      |
| ------------- | ------------- | ----------------------------------------------------------- |
| suggest, fill | page origin   | `sender.origin`, `sender.tab.url`, `webNavigation.getFrame` |
| suggest       | matches       | in memory index (rebuilt lazily on worker wake)             |
| lock          | last activity | `chrome.storage.session.last_activity_at`                   |
| PIN           | `device_id`   | `chrome.storage.local`                                      |
| save prompt   | default name  | the page host                                               |

**Key invariants**:
- Content scripts never hold the vault key, item keys, or any password except the one just clicked.
- The suggestion list never includes passwords.
- The extension CSP allows `wasm-unsafe-eval` only (for `hash-wasm`), no remote code.

**Critical test scenarios** (Playwright with the unpacked extension):
- Unlock, open a test `https` login page, click the icon and a suggestion, fields fill, verifies **AC-14**.
- The same page on `http`, in a cross origin iframe, with hidden fields, with a field covered by an overlay, or with a scripted (untrusted) click: nothing fills, verifies **AC-14**.
- Lookalike `examp1e.com` and sibling `other.github.io` get no suggestions, verifies **AC-14**.
- Submit a new login; the save bar appears; the item syncs to the web vault; a fetch based login also triggers the prompt, verifies **AC-15**, **AC-8**.
- 15 minutes without activity (mocked clock) locks; PIN unlocks; 5 wrong PINs require the master password; a 5 character PIN is refused, verifies **AC-13**.
- Copy a password, wait 30 seconds, the clipboard is empty, verifies **AC-19**.
- Network off: unlock from cache and fill still work, verifies **AC-10**.

## Build plan

1. (slice 1) `apps/extension` WXT project, popup unlock with master password, background sync using the shared cache, satisfies **AC-5**, **AC-8**.
2. (slice 1) Content script field detection, inline icon, `suggest` and `fill` with all six fill rules, satisfies **AC-14**.
3. Activity based lock, system lock, PIN unlock with failure counter, satisfies **AC-13**.
4. Popup search, copy, offscreen clipboard clear, generator, breach check, satisfies **AC-16**, **AC-18**, **AC-19**.
5. Save and update prompt, including script driven logins and change password forms, satisfies **AC-15**.
6. Offline unlock and fill, revoked vs expired handling, satisfies **AC-10**, **AC-22**.
7. Firefox build check (WXT target), noting gaps for a later Safari build, satisfies **AC-14**.
