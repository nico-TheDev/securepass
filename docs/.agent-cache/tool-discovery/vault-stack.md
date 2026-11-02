# Tool discovery: vault stack (2026-11-02)

Read-only discovery. Nothing installed. Skills came from `npx -y skills find <tool>`. Skills already in `npx -y skills list -g` were skipped (mattpocock setup-ts-deep-modules and migrate-to-shoehorn are already installed).

"Owner match" means the registry's repo owner is the tool's own org. Skill contents were not read, so nothing is confirmed beyond that.

## Agent Skills

### Hono

- honojs/skills@hono-jsx (451 installs): Hono JSX rendering. Owner match (honojs org).
- yusukebe/hono-skill@hono (12.6K): general Hono usage. Owner is the account of Hono's creator, not the honojs org. Not confirmed as official.
- Community, unverified: jezweb/claude-skills@hono-routing, hono-api-scaffolder; mindrally/skills@hono-typescript; bobmatnyc/claude-mpm-skills@hono-middleware, hono-testing, hono-validation.

### Cloudflare Workers

- cloudflare/skills@workers-best-practices (133.3K): Workers patterns. Owner match (Cloudflare).
- cloudflare/skills@workers-profiling, gateway-workers: Cloudflare org, scope not read.
- cloudflare/cloudflare-docs@workers-code-review (64): Cloudflare docs org, review checklist.

### Cloudflare D1

- No Cloudflare-published D1-specific skill found. The general cloudflare/skills@cf-cli (16.9K) is a Cloudflare CLI skill, not D1-specific.
- Community, unverified: jezweb/claude-skills@cloudflare-d1, d1-migration, d1-drizzle-schema; secondsky/claude-skills@cloudflare-d1; alinaqi/maggy@cloudflare-d1.

### Wrangler

- cloudflare/skills@wrangler (136.3K): Owner match (Cloudflare).
- cloudflare/cloudflare-docs@wrangler (104): Cloudflare docs org.
- developers.cloudflare.com@wrangler (569): owner is a domain, not confirmed as Cloudflare.

### WXT

- No WXT-org skill found.
- tenequm/skills@chrome-extension-wxt (216): WXT extension guidance. Community, unverified.
- pproenca/dot-skills@wxt-browser-extensions (1.1K): community, unverified.
- timeraa/skills@wxt (42): community, unverified.

### React

- vercel-labs/agent-skills@vercel-react-best-practices (862.2K), vercel-composition-patterns (432.8K): Vercel-published, not the React team. Not confirmed as React-official.
- No skill from the React core repo found.

### Vite

- antfu/skills@vite (40.8K): owner is Anthony Fu, a Vite maintainer. Owner match by person, not org.
- affaan-m/ecc@vite-patterns (7.7K): community, unverified.

### Vitest

- antfu/skills@vitest (45.5K): same owner as the Vite skill. Owner match by person.
- pproenca/dot-skills@vitest (6.7K), jezweb/claude-skills@vitest (1.8K), secondsky/claude-skills@vitest-testing (1.3K): community, unverified.

### Playwright

- microsoft/playwright-cli@playwright-cli (205.1K): Owner match (Microsoft).
- currents-dev/playwright-best-practices-skill@playwright-best-practices (101.4K): third-party (Currents), unverified.
- openai/skills@playwright (8.9K): OpenAI, unverified.

### pnpm workspaces

- antfu/skills@pnpm (22.6K): owner is Anthony Fu. Owner match by person.
- wshobson/agents@monorepo-management (14.8K): community, unverified.
- No pnpm-org skill found.

### @noble/ciphers and noble crypto

- Nothing credible. Queries "@noble/ciphers", "noble-ciphers", "noble hashes", "noble crypto" returned no results.

### hash-wasm

- Nothing credible. Queries "hash-wasm" and "hash wasm" returned unrelated packages. "wasm hashing" returned one unrelated result.

### TypeScript

- Skip mattpocock setup-ts-deep-modules and migrate-to-shoehorn (already installed).
- wshobson/agents@typescript-advanced-types (96.3K): community, unverified.
- jeffallan/claude-skills@typescript-pro (14.4K): community, unverified.
- No Microsoft TypeScript-org skill found.

## MCP servers

### Hono

- @hono/mcp (npm), repo honojs/middleware, packages/mcp. Publisher: honojs org (inferred from repo path, not stated as official). Streamable HTTP transport for Hono routes. Source: https://github.com/honojs/middleware/tree/main/packages/mcp
- Web search was rate-limited; this came from a GitHub page fetch.

### Cloudflare Workers

- Cloudflare-hosted remote MCP servers and template. Publisher: Cloudflare. Docs: https://developers.cloudflare.com/agents/capabilities/mcp-server
- Cloudflare labs page: https://labs.cloudflare.dev/mcp
- Third-party directory lists Cloudflare-hosted servers for docs, Workers bindings, builds, observability. Unverified against Cloudflare's own list: https://llmbase.ai/mcp-servers/cloudflare/

### Cloudflare D1

- No Cloudflare-published D1-only MCP server found.
- Directory listings describe a community server, npx @cloudflare/mcp-server-cloudflare init, with KV/R2/D1/Workers/Durable Objects CRUD. Unverified: https://mcp.so/zh/servers/mcp-server-cloudflare-blakeb254

### Wrangler

- Nothing credible. Wrangler CLI has no MCP server. Cloudflare's workers-mcp is a way to build an MCP server with Wrangler, not a Wrangler server.

### WXT

- MCP server for searchable WXT docs, listed on Glama. Publisher not identified; unverified: https://glama.ai/mcp/servers/integrations/wxt
- Nothing from the WXT project itself.

### React

- React Spectrum (Adobe) docs MCP: `npx @react-spectrum/mcp@latest`. Publisher: Adobe (a React component library, not React core). Source: https://react-spectrum.adobe.com/mcp
- Not React core. Cloudflare use-mcp is a client hook library, not a server: https://blog.cloudflare.com/connect-any-react-application-to-an-mcp-server-in-three-lines-of-code (search result).

### Vite

- Blowback, formerly "Vite MCP Server" (npm blowback-context). Publisher unclear; unverified: https://mcp.so/servers/vite-mcp-server?tab=tools
- vitemcp/server is a framework for building MCP servers, not a Vite MCP server: https://github.com/vitemcp/server

### Vitest

- madrus/vitest-mcp-server, Glama listing. Publisher: GitHub user madrus. Capabilities not inspected. Unverified: https://glama.ai/mcp/servers/madrus/vitest-mcp-server/schema

### Playwright

- @playwright/mcp (npm), repo microsoft/playwright-mcp. Publisher: Microsoft (repo owner). Browser automation through accessibility snapshots. Source: https://github.com/microsoft/playwright-mcp

### pnpm workspaces

- Nothing credible. Only sample monorepos that use pnpm, not an MCP server for pnpm.

### @noble/ciphers and noble crypto

- Nothing credible. A generic "Mcp Cryptography" listing does not say it uses @noble/ciphers.

### hash-wasm

- Nothing credible. hyper-mcp (tuananh) has a hash plugin, but it is not confirmed to use hash-wasm: https://github.com/ReliQuery/hyper-mcp

### TypeScript

- Nothing credible for the TypeScript language itself. The official MCP TypeScript SDK (github.com/modelcontextprotocol/typescript-sdk) is for building servers, not a TypeScript MCP server.

## Gaps and caveats

- Web search hit a rate limit for "Hono MCP server" and "Playwright MCP server". Those two were checked by fetching the GitHub pages instead.
- Registry results are listings only. No skill contents were read.
