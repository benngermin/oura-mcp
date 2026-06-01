#!/usr/bin/env node
// Standalone Oura OAuth — ZERO dependencies (Node 18+ built-ins only).
// Onboards a tenant to the LifeOS Oura cloud MCP without cloning any repo:
// this single file is all you need.
//
// Prereq: create an Oura app at https://developer.ouraring.com with redirect URI
//   exactly  http://localhost:9876/callback   and copy its Client ID + Secret.
//
// Run:
//   OURA_CLIENT_ID=xxx OURA_CLIENT_SECRET=yyy node standalone-auth.mjs
//
// It opens your browser, you click "Allow", and it prints a JSON credential blob.
// Send THAT blob to Benn over a secure channel (it contains your client secret +
// tokens). Benn loads it server-side and sends you back a bearer for your agent.

import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import { URL } from "node:url";

const PORT = 9876;
const REDIRECT_URI = `http://localhost:${PORT}/callback`;
const TOKEN_URL = "https://moi.ouraring.com/oauth/v2/ext/oauth-token";
const SCOPES = [
  "extapi:email", "extapi:personal", "extapi:daily", "extapi:heartrate",
  "extapi:workout", "extapi:tag", "extapi:session", "extapi:spo2",
  "extapi:ring_configuration", "extapi:stress", "extapi:heart_health",
].join(" ");

const clientId = process.env.OURA_CLIENT_ID;
const clientSecret = process.env.OURA_CLIENT_SECRET;
if (!clientId || !clientSecret) {
  console.error("Set OURA_CLIENT_ID and OURA_CLIENT_SECRET (from your app at https://developer.ouraring.com).");
  process.exit(1);
}

const state = randomBytes(16).toString("hex");
const authUrl =
  `https://cloud.ouraring.com/oauth/authorize?response_type=code` +
  `&client_id=${clientId}` +
  `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
  `&scope=${encodeURIComponent(SCOPES)}` +
  `&state=${state}`;

console.error("Open this URL in your browser to authorize Oura, then click Allow:\n");
console.error(authUrl + "\n");

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  if (url.pathname !== "/callback") { res.writeHead(404); res.end("Not found"); return; }
  if (url.searchParams.get("state") !== state) { res.writeHead(403); res.end("Bad state (possible CSRF)"); return; }

  const err = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  if (err) { res.writeHead(400); res.end(`Authorization failed: ${err}`); server.close(); process.exit(1); }
  if (!code) { res.writeHead(400); res.end("No authorization code"); server.close(); process.exit(1); }

  const tokenRes = await fetch(TOKEN_URL, {
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
    const t = await tokenRes.text();
    res.writeHead(500); res.end(`Token exchange failed: ${t}`);
    console.error("Token exchange failed:", t); server.close(); process.exit(1);
  }
  const tok = await tokenRes.json();

  res.writeHead(200, { "Content-Type": "text/html" });
  res.end("<h1>Authorized!</h1><p>Copy the JSON printed in your terminal and send it to Benn. You can close this tab.</p>");

  const blob = {
    client_id: clientId,
    client_secret: clientSecret,
    access_token: tok.access_token,
    refresh_token: tok.refresh_token,
    label: process.env.OURA_LABEL || "",
  };
  console.log("\n===== SEND THIS BLOB TO BENN (secure channel) =====");
  console.log(JSON.stringify(blob, null, 2));
  console.log("===================================================");
  server.close();
  process.exit(0);
});

server.listen(PORT, () => console.error(`Waiting for the Oura callback on ${REDIRECT_URI} ...`));
setTimeout(() => { console.error("Timed out waiting for authorization."); process.exit(1); }, 120_000).unref();
