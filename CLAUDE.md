# @lifeos/oura

First-party Oura Ring CLI + MCP server. Two runtimes (stdio MCP + CLI locally,
HTTP MCP in the cloud) share one tool set: `buildOuraMcpServer` in
`src/mcp-tools.ts`. See `README.md` for install, commands, and the full
tool/endpoint list.

Derived from the MIT-licensed `daveremy/oura-mcp`; now a first-party package,
no longer tracked against upstream. Credit stays in `README.md` and `LICENSE`.

## Do not break these

- `dist/mcp.js` is registered as the stdio MCP entrypoint in the Claude desktop
  app's `claude_desktop_config.json` (`command: node`, args pointing at this
  file's absolute path). Changing its path, name, or CLI-arg contract breaks
  that registration.
- On the HTTP server (`src/server.ts`), the bearer token is the sole tenant
  selector. No tool may take an owner/user parameter: that would make
  cross-tenant access possible. `ADMIN_KEY` (`/admin/tokens`, operator-only)
  must never be handed to an agent.

## Auth pitfalls

Non-obvious, easy to regress:

- Oura deprecated personal access tokens. OAuth2 is the only supported path.
- Authorize still redirects through `cloud.ouraring.com/oauth/authorize`, but
  token exchange and refresh now hit the new IdP:
  `https://moi.ouraring.com/oauth/v2/ext/oauth-token`. Don't collapse these
  back to one host.
- Scopes are `extapi:`-prefixed (e.g. `extapi:daily`), not the old bare names.

## Closure

Done when `npm run build && npm test` both exit 0.
