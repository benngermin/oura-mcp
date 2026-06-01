# @lifeos/oura — Oura Ring MCP Server & CLI

A first-party [Model Context Protocol](https://modelcontextprotocol.io) server and
command-line tool for querying [Oura Ring](https://ouraring.com) health data —
sleep, readiness, activity, workouts, heart rate, stress, SpO2, sessions, and
generic access to all 19 Oura v2 API collections.

Two runtimes share one tool definition:

- **stdio MCP + CLI** (`dist/mcp.js`, `dist/cli.js`) — local, single-user, reads
  tokens from `~/.oura-mcp/config.json`. Used by Benn's desktop Claude Code.
- **Multi-tenant HTTP MCP** (`dist/server.js`) — a tiny `node:http` server
  deployed to Fly, queried over HTTP by always-on cloud agents (Germ, Matthew's
  agent). Each agent's bearer token is the sole tenant selector; an agent reads
  **only** its own ring data. See `CLAUDE.md` for the isolation model.

## Features

- **12 MCP tools** — curated (`oura_daily_summary`, `oura_sleep`, …) plus a
  generic `oura_query` for any collection. The same 12 tools are registered by
  both the stdio and HTTP runtimes (`buildOuraMcpServer`).
- **CLI** — `oura sleep`, `oura readiness`, `oura activity`, `oura summary`, etc.
- **OAuth2** — authorization-code flow with automatic token refresh; rotated
  tokens persist back to config.json (stdio) or the per-owner token store (HTTP).
- **Sandbox** — demo-data routing for testing without a ring.

## Install

```bash
npm install
npm run build
```

## Auth (stdio / CLI)

1. Create an Oura app at https://developer.ouraring.com
2. Set the redirect URI to `http://localhost:9876/callback`
3. Put `OURA_CLIENT_ID` and `OURA_CLIENT_SECRET` in `.env`
4. Run `source .env && npm run dev -- auth` (or `node dist/cli.js auth` after a build)

Tokens are saved to `~/.oura-mcp/config.json` (0600). Oura has deprecated personal
access tokens, so OAuth2 is the only supported path.

## HTTP server (cloud)

```bash
# Env: BEARER_TOKENS='{"<owner>":"<token>"}'  ADMIN_KEY='<hex>'  DATA_DIR=/data  PORT=8080
npm run build && npm start
```

- `POST /mcp` — bearer auth; resolves the bearer to an owner, loads that owner's
  tokens from `${DATA_DIR}/tenants.json`, serves the 12 tools scoped to them.
- `POST /admin/tokens?owner=<o>` — `X-Admin-Key` only; loads a token blob for an
  owner (the manual-onboarding path; never exposed to agents).
- `GET /healthz` — liveness.

Deploy it as your own multi-tenant service: build the image (`Dockerfile`), set `BEARER_TOKENS` + `ADMIN_KEY`, mount a volume at `/data`, and run `dist/server.js`. New tenants are onboarded by `POST /admin/tokens?owner=<o>` with the `X-Admin-Key`.

## MCP tools

| Tool | Description |
|---|---|
| `oura_daily_summary` | Sleep, readiness, activity for a date |
| `oura_sleep` | Detailed sleep session data |
| `oura_readiness` | Readiness score and contributors |
| `oura_activity` | Daily activity (steps, calories, distance) |
| `oura_workouts` | Auto-detected workouts |
| `oura_heart_rate` | Continuous heart rate for a time window |
| `oura_stress` | Daily stress and recovery |
| `oura_spo2` | Blood oxygen (SpO2) |
| `oura_sessions` | Meditation/breathing sessions |
| `oura_trends` | Multi-day sleep/readiness scores |
| `oura_query` | Generic access to any of the 19 v2 collections |
| `oura_personal_info` | Account-level personal info |

## Development

```bash
npm run dev -- sleep      # run CLI via tsx
npm run mcp               # run stdio MCP server via tsx
npm run server            # run HTTP MCP server via tsx
npm run build             # compile to dist/
npm test                  # node:test suite (tenant-store unit + server integration)
```

## License & credit

MIT — see [`LICENSE`](./LICENSE). Originally derived from the MIT-licensed
[`daveremy/oura-mcp`](https://github.com/daveremy/oura-mcp); now maintained as a
first-party LifeOS package. Thanks to the original author for the foundation.
