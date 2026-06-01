# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/).

## 0.3.0 — First-party + cloud

### Changed
- **De-vendored.** Dropped the `@daveremy/oura-mcp` vendored/frozen framing and
  the upstream Claude-plugin marketplace scaffold (`.claude-plugin/`, bundled
  `skills/`, `VENDOR.md`, `CONTRIBUTING.md`). Now a first-party LifeOS package
  (`@lifeos/oura`), owned and updated on our own schedule. MIT credit to the
  original author retained in `README` and `LICENSE`.
- Re-pinned `@modelcontextprotocol/sdk` to the current `^1.29.0`.
- `OuraClient` token-refresh persistence is now injectable via an optional
  `onTokensRefreshed` constructor hook; the stdio/CLI path is unchanged (falls
  back to the `~/.oura-mcp/config.json` writeback).
- Factored the 12 tool registrations out of `mcp.ts` into a shared
  `buildOuraMcpServer(client)` (`src/mcp-tools.ts`); the stdio entrypoint stays
  `dist/mcp.js`.

### Added
- Multi-tenant HTTP MCP server (`src/server.ts` → `dist/server.js`) on bare
  `node:http` — bearer token → owner → per-request `OuraClient` scoped to that
  owner's tokens. Strict per-tenant isolation: no tool accepts an owner parameter.
- Per-owner token store (`src/tenant-store.ts`) at `${DATA_DIR}/tenants.json`
  (0600, atomic write); `ADMIN_KEY`-gated `/admin/tokens` onboarding path.
- `node:test` suite: tenant-store unit tests + HTTP server isolation/401 tests.
- `Dockerfile` and `fly.toml` for a scale-to-zero Fly deployment;
  `scripts/smoke-remote.mjs` for a live MCP smoke test.

## 0.2.0 — LifeOS r2

### Added
- Generic `oura_query` tool with auto-pagination across all 19 Oura v2 collections.
- `oura_personal_info` tool.
- Sandbox routing (`OURA_SANDBOX=1` or per-call `sandbox: true`).
- `ring_battery_level` and `ring_configuration` collections.

### Changed
- OAuth2 authorization-code flow replaces the personal-access-token assumption.
- Token endpoint migrated to Curity IdP (`moi.ouraring.com`).
- Refresh tokens now persist to `~/.oura-mcp/config.json`.

## 0.1.x — Upstream baseline

Initial CLI + stdio MCP (10 tools), OAuth2 with automatic token refresh, 30s
request timeouts, persistent token storage, and the companion `/oura` skill.
Derived from the MIT-licensed `daveremy/oura-mcp`.
