#!/usr/bin/env node
import { createServer as createHttpServer, type IncomingMessage, type ServerResponse, type Server } from "node:http";
import { timingSafeEqual } from "node:crypto";
import { fileURLToPath } from "node:url";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { OuraClient } from "./client.js";
import { buildOuraMcpServer } from "./mcp-tools.js";
import { createTenantStore, type TenantStore, type TenantBlob } from "./tenant-store.js";

type BuildClient = (
  blob: TenantBlob,
  onTokensRefreshed: (t: { accessToken: string; refreshToken: string }) => void,
) => OuraClient;

export interface OuraHttpServerOptions {
  /** Map of bearer token → owner. The bearer is the SOLE tenant selector. */
  tokenToOwner: Map<string, string>;
  /** Operator key for /admin/tokens. Never handed to agents. */
  adminKey: string;
  /** Per-owner token store. */
  store: TenantStore;
  /** Override the OuraClient factory (tests inject a fake). */
  buildClient?: BuildClient;
}

const defaultBuildClient: BuildClient = (blob, onTokensRefreshed) =>
  new OuraClient({
    accessToken: blob.access_token,
    refreshToken: blob.refresh_token,
    clientId: blob.client_id,
    clientSecret: blob.client_secret,
    onTokensRefreshed,
  });

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

function bearerToken(req: IncomingMessage): string | null {
  const auth = req.headers.authorization;
  if (typeof auth !== "string" || !auth.startsWith("Bearer ")) return null;
  const token = auth.slice("Bearer ".length).trim();
  return token || null;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(payload);
}

function sendUnauthorized(res: ServerResponse): void {
  res.setHeader("WWW-Authenticate", 'Bearer realm="mcp"');
  sendJson(res, 401, { jsonrpc: "2.0", error: { code: -32000, message: "Unauthorized" }, id: null });
}

function methodNotAllowed(res: ServerResponse): void {
  sendJson(res, 405, { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null });
}

async function readBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf-8");
  if (!raw) return undefined;
  return JSON.parse(raw);
}

/**
 * Build the multi-tenant Oura HTTP MCP server. The bearer token resolves to an
 * owner; that owner's stored tokens build a per-request OuraClient; the 12 tools
 * are served scoped to it. No tool takes an owner parameter, so isolation is
 * airtight by construction. Operator (`ADMIN_KEY`) access is a separate path.
 */
export function createOuraHttpServer(opts: OuraHttpServerOptions): Server {
  const { tokenToOwner, adminKey, store } = opts;
  const buildClient = opts.buildClient ?? defaultBuildClient;

  return createHttpServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", "http://localhost");
      const path = url.pathname;
      const method = req.method ?? "GET";

      if (path === "/healthz" && method === "GET") {
        sendJson(res, 200, { ok: true });
        return;
      }

      // --- MCP endpoint: bearer → owner → that owner's client only ---
      if (path === "/mcp") {
        const token = bearerToken(req);
        const owner = token ? tokenToOwner.get(token) : undefined;
        if (!owner) {
          sendUnauthorized(res);
          return;
        }
        if (method !== "POST") {
          // Stateless transport has no server→client stream / session to delete.
          methodNotAllowed(res);
          return;
        }

        const blob = store.loadTenant(owner);
        if (!blob) {
          sendJson(res, 500, {
            jsonrpc: "2.0",
            error: { code: -32000, message: `No Oura credentials loaded for owner "${owner}"` },
            id: null,
          });
          return;
        }

        const client = buildClient(blob, (t) =>
          store.updateTokens(owner, { access: t.accessToken, refresh: t.refreshToken }),
        );
        const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
        const server = buildOuraMcpServer(client);
        res.on("close", () => {
          transport.close();
          server.close();
        });
        await server.connect(transport);
        const body = await readBody(req);
        await transport.handleRequest(req, res, body);
        return;
      }

      // --- Admin onboarding: load a tenant's token blob (operator only) ---
      if (path === "/admin/tokens") {
        const provided = req.headers["x-admin-key"];
        const key = Array.isArray(provided) ? provided[0] : provided;
        if (!adminKey || typeof key !== "string" || !safeEqual(key, adminKey)) {
          sendUnauthorized(res);
          return;
        }
        if (method === "GET") {
          // List owners (masked) — no tokens returned.
          sendJson(res, 200, { owners: store.listOwners() });
          return;
        }
        if (method === "POST") {
          const owner = url.searchParams.get("owner");
          if (!owner) {
            sendJson(res, 400, { error: "Missing ?owner=" });
            return;
          }
          let blob: unknown;
          try {
            blob = await readBody(req);
          } catch {
            sendJson(res, 400, { error: "Body must be a JSON token blob" });
            return;
          }
          if (!isTenantBlob(blob)) {
            sendJson(res, 400, {
              error: "Blob must include client_id, client_secret, access_token, refresh_token",
            });
            return;
          }
          store.saveTenant(owner, blob);
          sendJson(res, 200, { ok: true, owner });
          return;
        }
        methodNotAllowed(res);
        return;
      }

      sendJson(res, 404, { error: "Not found" });
    } catch (err) {
      console.error("[oura-server] request error:", err);
      if (!res.headersSent) {
        sendJson(res, 500, {
          jsonrpc: "2.0",
          error: { code: -32603, message: "Internal server error" },
          id: null,
        });
      }
    }
  });
}

function isTenantBlob(v: unknown): v is TenantBlob {
  if (!v || typeof v !== "object") return false;
  const b = v as Record<string, unknown>;
  return (
    typeof b.client_id === "string" &&
    typeof b.client_secret === "string" &&
    typeof b.access_token === "string" &&
    typeof b.refresh_token === "string"
  );
}

/** Parse BEARER_TOKENS (owner→token JSON) into a token→owner map. FATAL on bad config. */
export function parseBearerTokens(raw: string): Map<string, string> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("FATAL: BEARER_TOKENS is not valid JSON:", err);
    process.exit(1);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    console.error("FATAL: BEARER_TOKENS must be a JSON object mapping owner -> bearer");
    process.exit(1);
  }
  const tokenToOwner = new Map<string, string>();
  for (const [owner, token] of Object.entries(parsed as Record<string, unknown>)) {
    if (!owner) {
      console.error("FATAL: BEARER_TOKENS contains an empty owner key");
      process.exit(1);
    }
    if (typeof token !== "string" || token.length < 16) {
      console.error(`FATAL: BEARER_TOKENS["${owner}"] must be a string of at least 16 chars`);
      process.exit(1);
    }
    if (tokenToOwner.has(token)) {
      console.error("FATAL: BEARER_TOKENS reuses the same token for two owners");
      process.exit(1);
    }
    tokenToOwner.set(token, owner);
  }
  if (tokenToOwner.size === 0) {
    console.error("FATAL: BEARER_TOKENS must define at least one owner");
    process.exit(1);
  }
  return tokenToOwner;
}

function main(): void {
  const raw = process.env.BEARER_TOKENS;
  if (!raw) {
    console.error('FATAL: BEARER_TOKENS env var is required, e.g. {"benn":"<hex>"}');
    process.exit(1);
  }
  const adminKey = process.env.ADMIN_KEY;
  if (!adminKey) {
    console.error("FATAL: ADMIN_KEY env var is required");
    process.exit(1);
  }
  const port = parseInt(process.env.PORT ?? "8080", 10);
  const dataDir = process.env.DATA_DIR ?? "/data";

  const tokenToOwner = parseBearerTokens(raw);
  const store = createTenantStore(dataDir);
  const server = createOuraHttpServer({ tokenToOwner, adminKey, store });

  server.listen(port, () => {
    console.error(`[oura-server] listening on :${port} (data: ${dataDir})`);
    console.error(`[oura-server] owners: ${[...tokenToOwner.values()].join(", ")}`);
  });

  const shutdown = () => {
    console.error("[oura-server] shutting down...");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

// Run only when executed directly (not when imported by tests).
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main();
}
