# Vault (@securepass/vault)

## Overview

Client side vault logic shared by the web vault and the extension: the API client, unlock and sign in flows, item editing, conflict rules, the sync round with rollback checks, the generator, the breach check, URL matching, and the LastPass import. It sits on top of `packages/crypto` and `packages/shared` and has no UI.

## Commands

```bash
pnpm --filter @securepass/vault typecheck
pnpm --filter @securepass/vault test
```

## Conventions

Inherits the root `AGENTS.md` rules. Every function takes what it needs (cache, vault key, API client) as arguments, so the web vault and the extension can each pass their own.

## Related specs

[0003-web-vault.md](../../docs/specs/0001-securepass-vault/0003-web-vault.md), [0004-browser-extension.md](../../docs/specs/0001-securepass-vault/0004-browser-extension.md)
