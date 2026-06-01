# Onboarding to the Oura cloud MCP (for Matthew)

This lets your always-on cloud agent query **your** Oura Ring data (sleep,
readiness, activity, HR, etc.) over HTTP. You're a tenant on a shared server Benn
operates. Your bearer token is the only thing that selects your data — you read
**only your own ring**, never anyone else's, and you never get an admin key or
anyone else's token.

You can hand this whole file to your Claude Code; it can do steps 1, 2, and 5.
Steps 3–4 are Benn's (they need his operator key).

---

## 1. Create your own Oura developer app

1. Go to https://developer.ouraring.com → **Create New Application**.
2. Set the **Redirect URI** to exactly: `http://localhost:9876/callback`
3. Enable all data scopes (for full coverage).
4. Copy your **Client ID** and **Client Secret**.

## 2. Get your credential blob (one self-contained file, no repo needed)

Benn will send you `standalone-auth.mjs` (zero dependencies, Node 18+). Run:

```bash
OURA_CLIENT_ID=<your-client-id> OURA_CLIENT_SECRET=<your-client-secret> \
  node standalone-auth.mjs
```

A browser opens → click **Allow** → the script prints a JSON blob like:

```json
{
  "client_id": "...",
  "client_secret": "...",
  "access_token": "...",
  "refresh_token": "...",
  "label": ""
}
```

## 3. Send that blob to Benn (secure channel)

It contains your client secret + tokens, so don't paste it in a public place.
Benn loads it into the server under `owner=matthew` and mints you a bearer.

## 4. Benn sends you back ONE value

`MATT_OURA_BEARER` — a 64-char hex string. That's the only credential your agent needs.

## 5. Wire your agent (your Claude Code can do this)

Add an HTTP MCP server to your agent's `mcpServers` map:

```ts
oura: {
  type: 'http',
  url: 'https://lifeos-oura.fly.dev/mcp',
  headers: { Authorization: 'Bearer <MATT_OURA_BEARER>' },
}
```

Store the bearer as a secret (e.g. `fly secrets set OURA_MCP_TOKEN='Bearer <hex>' OURA_MCP_URL='https://lifeos-oura.fly.dev/mcp'`) and read it from env — don't hardcode it.

### Tools (namespaced `mcp__oura__*`)

`oura_daily_summary`, `oura_sleep`, `oura_readiness`, `oura_activity`,
`oura_workouts`, `oura_heart_rate`, `oura_stress`, `oura_spo2`, `oura_sessions`,
`oura_trends`, `oura_query` (generic access to any of the 19 Oura v2 collections),
`oura_personal_info`.

Once wired, ask your agent something like "how did I sleep last night."

---

## Notes

- The server is scale-to-zero; the first query after idle cold-starts in ~1-3s.
- Token refresh is automatic and server-side — you don't manage it after step 3.
- If you rotate your Oura app or revoke access, re-run step 2 and resend the blob.
