# Server (@securepass/server)

## Overview

Hono API on Cloudflare Workers with a D1 database. It stores only ciphertext and settings, never plaintext.

## Commands

```bash
pnpm --filter @securepass/server dev
pnpm --filter @securepass/server typecheck
pnpm --filter @securepass/server build
```

## Conventions

Inherits the root `AGENTS.md` rules. Deeper conventions come from `/audit apps/server` or the first feature built here.

## Related specs

[0002-sync-server.md](../../docs/specs/0001-securepass-vault/0002-sync-server.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
