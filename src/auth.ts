import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";
import { URL } from "node:url";
import type { OuraTokens } from "./types.js";
import { loadConfig, saveConfig, getConfigPath } from "./config.js";

const PORT = 9876;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
// Oura's new identity provider (moi.ouraring.com) namespaces scopes under "extapi:".
// These exact strings come from the app-creation form's checkbox values, verified
// against the live authorize endpoint. All 11 available scopes are requested for
// full read coverage of every collection (single-user personal app).
const SCOPES = [
  "extapi:email",
  "extapi:personal",
  "extapi:daily",
  "extapi:heartrate",
  "extapi:workout",
  "extapi:tag",
  "extapi:session",
  "extapi:spo2",
  "extapi:ring_configuration",
  "extapi:stress",
  "extapi:heart_health",
].join(" ");

export async function runAuthFlow(): Promise<void> {
  const clientId = process.env.OURA_CLIENT_ID;
  const clientSecret = process.env.OURA_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    console.error("Missing OURA_CLIENT_ID or OURA_CLIENT_SECRET in environment.");
    console.error("Set them in .env and run: source .env && oura auth");
    process.exit(1);
  }

  const state = randomBytes(16).toString("hex");

  const authUrl =
    `https://cloud.ouraring.com/oauth/authorize?response_type=code` +
    `&client_id=${clientId}` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPES)}` +
    `&state=${state}`;

  console.log("Opening browser for Oura authorization...");
  console.log(`If it doesn't open, go to:\n${authUrl}\n`);

  try {
    execSync(`open "${authUrl}"`);
  } catch {
    // User can copy the URL manually
  }

  return new Promise((resolve) => {
    let timeout: NodeJS.Timeout;

    const server = createServer(async (req, res) => {
      const url = new URL(req.url!, `http://localhost:${PORT}`);

      if (url.pathname !== "/callback") {
        res.writeHead(404);
        res.end("Not found");
        return;
      }

      const code = url.searchParams.get("code");
      const error = url.searchParams.get("error");
      const returnedState = url.searchParams.get("state");

      if (returnedState !== state) {
        res.writeHead(403);
        res.end("Invalid state parameter — possible CSRF attack.");
        return;
      }

      clearTimeout(timeout);

      if (error) {
        res.writeHead(400);
        res.end(`Authorization failed: ${error}`);
        console.error(`Authorization failed: ${error}`);
        server.close();
        process.exit(1);
      }

      if (!code) {
        res.writeHead(400);
        res.end("No authorization code received");
        server.close();
        process.exit(1);
      }

      console.log("Received authorization code. Exchanging for tokens...");

      const tokenRes = await fetch("https://moi.ouraring.com/oauth/v2/ext/oauth-token", {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          client_id: clientId,
          client_secret: clientSecret,
          redirect_uri: REDIRECT_URI,
        }),
      });

      if (!tokenRes.ok) {
        const err = await tokenRes.text();
        res.writeHead(500);
        res.end(`Token exchange failed: ${err}`);
        console.error("Token exchange failed:", err);
        server.close();
        process.exit(1);
      }

      const tokens: OuraTokens = await tokenRes.json();

      // Persist tokens + client credentials so the CLI and MCP server auto-load
      // them from ~/.oura-mcp/config.json (0600) — no manual env wiring needed.
      const cfg = loadConfig();
      cfg.accessToken = tokens.access_token;
      cfg.refreshToken = tokens.refresh_token;
      cfg.clientId = clientId;
      cfg.clientSecret = clientSecret;
      saveConfig(cfg);

      console.error(`\nTokens saved to ${getConfigPath()} — the MCP server will use them automatically.`);

      res.writeHead(200, { "Content-Type": "text/html" });
      res.end("<h1>Oura CLI authorized!</h1><p>You can close this tab.</p>");

      server.close();
      resolve();
    });

    server.listen(PORT, () => {
      console.error(`Waiting for Oura callback on http://localhost:${PORT} ...`);
    });

    // Timeout after 2 minutes
    timeout = setTimeout(() => {
      console.error("Timed out waiting for authorization callback.");
      server.close();
      process.exit(1);
    }, 120_000);
    timeout.unref();
  });
}
