# securepass

## Stack

- **Language / Runtime**: TypeScript (strict), Node 22 or newer for tooling
- **Apps**: Hono on Cloudflare Workers + D1 (server), React + Vite (web vault), WXT Manifest V3 (extension)
- **Key dependencies**: @noble/ciphers, hash-wasm (Argon2id), zod, Drizzle, tldts, idb
- **Package manager**: pnpm workspace (`apps/*`, `packages/*`)
- Source of truth: [docs/specs/0001-securepass-vault/index.md](docs/specs/0001-securepass-vault/index.md)

## Build approach

Tracer Bullet: one real login item travels through every layer first, then each later slice thickens one strand of that working thread.

## Commands

```bash
pnpm install
pnpm dev:server | dev:web | dev:extension
pnpm build
pnpm typecheck
```

## Specs

Stored in `docs/specs/`. Scope lives in `docs/scope/`.

## Rules

- Functional style: pure functions by default, immutable data, side effects pushed to the edges, no shared mutable state. Prefer plain functions over classes.
- Expected failures return a `Result` style value, not a thrown exception. One error handling pattern across server and clients.
- Strict types: no `any`, keep `noUncheckedIndexedAccess` on. Share types and zod schemas through `packages/shared`.
- Folder by feature inside each app (items, auth, sync). Shared code goes in `packages/`.
- Apps call `packages/crypto`; never import `@noble/ciphers` or `hash-wasm` directly.
- Validate env vars and bindings at startup (zod) and fail fast.
- Named exports only, except where a framework requires a default export.
- Naming: camelCase values, PascalCase types and components, kebab-case files.
- TSDoc on every exported function, especially in `packages/crypto`.
- Web vault and extension popup meet an accessibility baseline of WCAG AA.
- Commits follow Conventional Commits (`feat:`, `fix:`, `chore:`).

## Tooling

Chosen here, installed by `/develop tooling`.
- Lint and format: Biome, one root config for all workspaces (replaces the oxlint in `apps/web`).
- Pre commit: lint, format, and typecheck on staged work, via a git hook runner (lefthook).
- Testing gate: unit and integration with Vitest (crypto test vectors, API tests); Playwright for end to end later. The runner is set up by `/test`.
- CI: a basic GitHub Actions check on push (lint, typecheck, test).

## Git

- integration: on
- branch prefix: feat/
- commit: per-milestone

## Agent skills

- [vitest](.agents/skills/vitest/): `antfu/skills`, Vitest conventions for the test setup
- [workers-best-practices](.agents/skills/workers-best-practices/): `cloudflare/skills`, Workers patterns for `apps/server`

MCP servers: Cloudflare (recommended), Playwright (recommended)

## Context files

- [apps/server/AGENTS.md](apps/server/AGENTS.md) (Hono API on Workers and D1)
- [apps/web/AGENTS.md](apps/web/AGENTS.md) (React + Vite web vault)
- [apps/extension/AGENTS.md](apps/extension/AGENTS.md) (WXT browser extension)
- [packages/crypto/AGENTS.md](packages/crypto/AGENTS.md) (shared crypto)
- [packages/shared/AGENTS.md](packages/shared/AGENTS.md) (shared types and zod schemas)

_Drafted by /audit from the repo, worth a quick human pass. Edit freely: once a line stops matching this draft, later runs treat it as curated and will flag rather than overwrite it._
