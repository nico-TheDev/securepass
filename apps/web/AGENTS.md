# Web vault (@securepass/web)

## Overview

React + Vite single page app where you manage the vault. Linting is oxlint today, to be replaced by the root Biome setup.

## Commands

```bash
pnpm --filter @securepass/web dev
pnpm --filter @securepass/web typecheck
pnpm --filter @securepass/web build
pnpm --filter @securepass/web test
```

Tests run in Vitest (node by default). Component and hook tests opt in to jsdom with a `// @vitest-environment jsdom` comment at the top of the file.

- Design system: build all UI to [design.md](./design.md) (art direction and the maximalist product bar); token values live in CSS. Product context is in [PRODUCT.md](./PRODUCT.md).

## Conventions

Inherits the root `AGENTS.md` rules. Deeper conventions come from `/audit apps/web` or the first feature built here.

## Related specs

[0003-web-vault.md](../../docs/specs/0001-securepass-vault/0003-web-vault.md)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
