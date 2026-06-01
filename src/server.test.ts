import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createOuraHttpServer } from "./server.js";
import { createTenantStore, type TenantBlob } from "./tenant-store.js";
import type { OuraClient } from "./client.js";

// Fake client factory: encodes the owner via the blob so a tools/call result
// reveals WHICH tenant's credentials were used — proving the bearer→owner→blob
// binding without hitting the real Oura API.
function fakeBuildClient(blob: TenantBlob): OuraClient {
  return {
    getCollection: async () => ({ data: [{ marker: blob.access_token }] }),
  } as unknown as OuraClient;
}

async function startServer(): Promise<{ url: string; close: () => void }> {
  const dir = mkdtempSync(join(tmpdir(), "oura-srv-"));
  const store = createTenantStore(dir);
  store.saveTenant("alice", {
    client_id: "ca", client_secret: "sa", access_token: "ACCESS-ALICE", refresh_token: "ra",
  });
  store.saveTenant("bob", {
    client_id: "cb", client_secret: "sb", access_token: "ACCESS-BOB", refresh_token: "rb",
  });
  const server = createOuraHttpServer({
    tokenToOwner: new Map([["tokA", "alice"], ["tokB", "bob"]]),
    adminKey: "ADMIN-SECRET",
    store,
    buildClient: fakeBuildClient,
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as AddressInfo;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () => {
          server.close();
          rmSync(dir, { recursive: true, force: true });
        },
      });
    });
  });
}

async function mcpClient(baseUrl: string, bearer: string): Promise<Client> {
  const client = new Client({ name: "test", version: "0" });
  const transport = new StreamableHTTPClientTransport(new URL(baseUrl + "/mcp"), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}

test("tools/list returns the 12 Oura tools", async () => {
  const srv = await startServer();
  try {
    const client = await mcpClient(srv.url, "tokA");
    const { tools } = await client.listTools();
    const names = tools.map((t) => t.name).sort();
    assert.equal(tools.length, 12, `expected 12 tools, got ${tools.length}: ${names.join(",")}`);
    assert.ok(names.includes("oura_daily_summary"));
    assert.ok(names.includes("oura_query"));
    assert.ok(names.includes("oura_personal_info"));
    await client.close();
  } finally {
    srv.close();
  }
});

test("each bearer reads ONLY its own tenant's data (cross-tenant isolation)", async () => {
  const srv = await startServer();
  try {
    const a = await mcpClient(srv.url, "tokA");
    const b = await mcpClient(srv.url, "tokB");
    const ra = await a.callTool({ name: "oura_personal_info", arguments: {} });
    const rb = await b.callTool({ name: "oura_personal_info", arguments: {} });
    const ta = JSON.stringify(ra.content);
    const tb = JSON.stringify(rb.content);
    assert.ok(ta.includes("ACCESS-ALICE"), `alice's call should use alice creds: ${ta}`);
    assert.ok(!ta.includes("ACCESS-BOB"), "alice must not see bob's data");
    assert.ok(tb.includes("ACCESS-BOB"), `bob's call should use bob creds: ${tb}`);
    assert.ok(!tb.includes("ACCESS-ALICE"), "bob must not see alice's data");
    await a.close();
    await b.close();
  } finally {
    srv.close();
  }
});

test("POST /mcp with a missing or unknown bearer → 401", async () => {
  const srv = await startServer();
  try {
    const headersBase = {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    };
    const body = JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    const noAuth = await fetch(srv.url + "/mcp", { method: "POST", headers: headersBase, body });
    assert.equal(noAuth.status, 401);
    const badAuth = await fetch(srv.url + "/mcp", {
      method: "POST",
      headers: { ...headersBase, Authorization: "Bearer nope" },
      body,
    });
    assert.equal(badAuth.status, 401);
  } finally {
    srv.close();
  }
});

test("POST /admin/tokens requires the admin key (constant-time); 401 without it", async () => {
  const srv = await startServer();
  try {
    const blob = {
      client_id: "cc", client_secret: "sc", access_token: "ACCESS-CAROL", refresh_token: "rc",
    };
    const u = srv.url + "/admin/tokens?owner=carol";
    const noKey = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(blob),
    });
    assert.equal(noKey.status, 401);
    const wrongKey = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "WRONG" },
      body: JSON.stringify(blob),
    });
    assert.equal(wrongKey.status, 401);
    const ok = await fetch(u, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Admin-Key": "ADMIN-SECRET" },
      body: JSON.stringify(blob),
    });
    assert.equal(ok.status, 200);
  } finally {
    srv.close();
  }
});

test("GET /healthz → { ok: true }", async () => {
  const srv = await startServer();
  try {
    const r = await fetch(srv.url + "/healthz");
    assert.equal(r.status, 200);
    const j = (await r.json()) as { ok: boolean };
    assert.equal(j.ok, true);
  } finally {
    srv.close();
  }
});
