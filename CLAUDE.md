# @lifeos/oura

First-party Oura Ring CLI + MCP server. Two runtimes, one tool definition.

> Originally derived from the MIT-licensed `daveremy/oura-mcp`; now a first-party
> LifeOS package (no longer vendored/tracked against an upstream). Credit retained
> in `README.md` and `LICENSE`.

## Runtimes

- **stdio MCP** (`dist/mcp.js`) — local, single-user. Registered in Benn's
  desktop Claude Code as `{"command":"node","args":[".../oura-mcp/dist/mcp.js"]}`.
  **Keep `dist/mcp.js` as the stdio entrypoint** — changing it breaks that
  registration.
- **CLI** (`dist/cli.js`) — `oura sleep|readiness|activity|summary`, `oura auth`.
- **HTTP MCP** (`dist/server.js`) — multi-tenant, deployed to Fly (`lifeos-oura`),
  queried over HTTP by cloud agents (Germ, Matthew's agent).

## Architecture

- `src/types.ts` — partial, hand-curated types for the subset surfaced by the dedicated helper methods (not exhaustive; `oura_query` returns untyped `Record<string, unknown>`)
- `src/collections.ts` — single source of truth registering all 19 Oura v2 `usercollection` endpoints (powers the generic `oura_query` tool)
- `src/client.ts` — `OuraClient` wrapping the Oura REST API with automatic token refresh. Refresh persistence is injectable via the optional `onTokensRefreshed` constructor hook (HTTP server → token store); without it, falls back to the `~/.oura-mcp/config.json` writeback used by stdio/CLI.
- `src/auth.ts` — OAuth2 authorization flow (browser + local callback server on port 9876)
- `src/config.ts` — Persistent token storage at `~/.oura-mcp/config.json` (stdio/CLI)
- `src/cli.ts` — CLI entry point using commander
- `src/mcp.ts` — stdio MCP entrypoint: `buildOuraMcpServer(OuraClient.fromEnv()).connect(new StdioServerTransport())`
- `src/mcp-tools.ts` — `buildOuraMcpServer(client)`: registers the 12 tools shared by both runtimes
- `src/tenant-store.ts` — per-owner token store for the HTTP server: JSON at `${DATA_DIR}/tenants.json` (0600, atomic write); `loadTenant`/`saveTenant`/`updateTokens`/`listOwners`
- `src/server.ts` — multi-tenant HTTP MCP server on bare `node:http`

## Isolation model (HTTP server)

The bearer token is the **sole** tenant selector. `BEARER_TOKENS` maps
`token → owner`; `/mcp` resolves the bearer to an owner, loads that owner's tokens
from the tenant store, and builds an `OuraClient` bound to them. **No tool accepts
an owner/user parameter**, so there is no path to cross tenants. Benn's operator
access to all tenants is a separate `ADMIN_KEY` path (`/admin/tokens`) used
out-of-band — it is **never** wired into any agent. Day-to-day, an agent carries
only its own tenant bearer.

## Auth (stdio / CLI)

OAuth2 authorization code flow (Oura has deprecated personal access tokens):
1. Create an Oura app at https://developer.ouraring.com
2. Set redirect URI to `http://localhost:9876/callback`
3. Set `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET` in `.env`
4. Run `oura auth` to open the browser and exchange code for tokens
5. Tokens are saved to `~/.oura-mcp/config.json` (0600); CLI and stdio MCP load them automatically

Auth endpoints (Oura migrated its IdP to Curity / `moi.ouraring.com`):
- Authorize: `https://cloud.ouraring.com/oauth/authorize` (redirects to the new IdP)
- Token exchange + refresh: `https://moi.ouraring.com/oauth/v2/ext/oauth-token`
- Scopes are `extapi:`-prefixed (e.g. `extapi:daily`, `extapi:heart_health`)

The client auto-refreshes expired tokens on 401 responses and persists rotated tokens.

## CLI Commands

- `oura auth` — run OAuth flow (saves tokens to ~/.oura-mcp/config.json)
- `oura config set-token <token>` — save a legacy personal access token (PATs are deprecated by Oura)
- `oura config show` — show stored config (masked)
- `oura config clear` — remove stored credentials
- `oura sleep [--date YYYY-MM-DD]` — daily sleep score + sleep periods
- `oura readiness [--date YYYY-MM-DD]` — daily readiness score
- `oura activity [--date YYYY-MM-DD]` — daily activity data
- `oura summary [--date YYYY-MM-DD]` — sleep, readiness, and activity for a day

All data commands output JSON to stdout. Default date is today.

## HTTP server env

- `BEARER_TOKENS` — JSON `{ "<token>": "<owner>" }` (token ≥ 16 chars); maps agent bearers to owners
- `ADMIN_KEY` — operator key for `/admin/tokens` (never given to agents)
- `DATA_DIR` — directory for `tenants.json` (default `/data`; a Fly volume in prod)
- `PORT` — listen port (default 8080)

## Dev

- `npm run dev -- sleep` — run CLI via tsx (no build needed)
- `npm run mcp` — run stdio MCP via tsx
- `npm run server` — run HTTP MCP via tsx
- `npm run build` — compile TypeScript to dist/
- `npm test` — node:test suite (tenant-store unit + server integration)
- Env overrides: OURA_ACCESS_TOKEN, OURA_REFRESH_TOKEN take precedence over stored config
