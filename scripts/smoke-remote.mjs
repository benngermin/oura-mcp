#!/usr/bin/env node
// Smoke-test the remote Oura HTTP MCP over the real Streamable HTTP transport:
// initialize + tools/list + one tools/call, exactly as Germ does.
//
// Usage (run from tools/mcps/oura-mcp so the SDK resolves):
//   node scripts/smoke-remote.mjs <url> <bearer-hex> [tool]
//   node scripts/smoke-remote.mjs https://lifeos-oura.fly.dev/mcp "$BENN_OURA_BEARER" oura_daily_summary
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

const [, , url, bearer, tool = "oura_daily_summary"] = process.argv;
if (!url || !bearer) {
  console.error("Usage: node scripts/smoke-remote.mjs <url> <bearer-hex> [tool]");
  process.exit(1);
}

const client = new Client({ name: "oura-smoke", version: "0" });
const transport = new StreamableHTTPClientTransport(new URL(url), {
  requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
});
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`tools/list: ${tools.length} tools`);

const res = await client.callTool({ name: tool, arguments: {} });
const out = JSON.stringify(res.content, null, 2);
console.log(`${tool} ->`, out.length > 900 ? out.slice(0, 900) + " …(truncated)" : out);

await client.close();
