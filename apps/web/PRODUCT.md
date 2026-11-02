# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

One person: the owner of a self hosted vault. A technical individual who runs their own sync server on Cloudflare and keeps all their logins in it. They set the vault up once on a laptop, then manage it there. On a phone they mostly search and copy a password. The browser extension is their daily driver for filling logins; the web vault is where they set up, unlock, and manage.

## Product Purpose

securepass is a personal zero knowledge password manager. Everything is encrypted on the device before it leaves, so the server only stores scrambled data. The web vault is where you create the account with a recovery kit, unlock with the master password, and manage items. Success: you can set up, unlock in under 2 seconds, create a login, and see it in the list after a sync, and you trust that nothing readable ever left your device.

## Positioning

Your own vault on your own server, with a design that avoids the specific weaknesses found in LastPass (weak and server controlled key stretching, encryption without tamper checks, unencrypted URLs). One account, no sharing, no vendor.

## Operating Context

- The web page is delivered by the same server it is meant to distrust, so the trust limit is part of the product: the master password should be typed here only on trusted devices, and the Unlock screen says so.
- Setup produces a recovery kit file (`securepass-recovery-kit.txt`) holding the recovery key in Base32 groups of four. Setup is only finished once the user retypes the last group.
- The vault works offline from an encrypted copy in the browser. Decrypted data exists only in memory while unlocked. Auto lock after 15 minutes of inactivity.
- Unlock must feel fast: under 2 seconds with the correct master password.

## Capabilities and Constraints

- Stack is fixed: React + Vite single page app, strict TypeScript, served from the same Worker as the API.
- This slice covers Setup (email, master password with strength meter, recovery kit download and confirm), Unlock, and an item list where one login can be created. Later slices add notes, identities, edit, trash, generator, import, devices, and TOTP enrollment.
- Strength meter runs locally.
- Wrong master password fails on the vault key tamper check; the error must not reveal more than that.
- No plaintext secret is ever stored outside memory.

## Brand Commitments

Name only: securepass. No logo, colors, or voice exist yet; free hand.

## Evidence on Hand

No screenshots, references, or brand assets. No users or testimonials to cite. Do not fabricate any.

## Product Principles

- Be honest about what the page can and cannot protect; state the trust limit plainly rather than hiding it.
- Never show a secret by accident: passwords are hidden by default and revealed or copied by deliberate action.
- The recovery kit is the one ceremony; make it unmistakable and impossible to skip by mistake.
- Speed and calm: a locked vault is a normal state, not an alarm.

## Accessibility & Inclusion

Meets WCAG AA (project rule). Fully keyboard operable, visible focus, labelled form fields, no information by color alone, respects reduced motion and both light and dark themes.
