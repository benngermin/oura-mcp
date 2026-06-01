#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { OuraClient } from "./client.js";
import { buildOuraMcpServer } from "./mcp-tools.js";

async function main() {
  const client = OuraClient.fromEnv();
  const server = buildOuraMcpServer(client);
  await server.connect(new StdioServerTransport());
}

main().catch((err) => {
  console.error("Oura MCP server error:", err);
  process.exit(1);
});
