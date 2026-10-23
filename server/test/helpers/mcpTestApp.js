import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";

/**
 * Starts a real app with the MCP endpoint and the routes its tools call, on a
 * fresh temp DATA_DIR. Every server module reads env at import time, so they
 * are imported here, after the env is set. node:test runs each test file in
 * its own process, so call this once per file.
 *
 * @param {{ users: Array<{ id: string, email: string, role: string, emailVerified?: boolean }>, superAdminEmail?: string }} options
 */
export async function startTestApp({ users, superAdminEmail } = {}) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "mcp-app-"));
  process.env.DATA_DIR = dataDir;
  process.env.OUTPUT_DIR = path.join(dataDir, "outputs");
  process.env.JWT_SECRET = "mcp-test-secret";
  if (superAdminEmail) process.env.SUPER_ADMIN_EMAIL = superAdminEmail;

  const userRows = users || [];
  fs.writeFileSync(path.join(dataDir, "users.json"), JSON.stringify({ users: userRows }, null, 2));

  const { default: express } = await import("express");
  const { requireAuth, signToken } = await import("../../src/auth.js");
  const { withUserScope } = await import("../../src/middleware/userScope.js");
  const { default: authRouter } = await import("../../src/routes/auth.js");
  const { default: billingRouter } = await import("../../src/routes/billing.js");
  const { default: jobsRouter } = await import("../../src/routes/jobs.js");
  const { createMcpRouter } = await import("../../src/mcp/transport.js");
  const { createKey } = await import("../../src/lib/agentKeys/store.js");

  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/api/auth", authRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/jobs", requireAuth, withUserScope, jobsRouter);
  app.use("/api/mcp", createMcpRouter());

  const server = await new Promise((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const { port } = server.address();

  function jwtFor(userId) {
    const row = userRows.find((u) => u.id === userId);
    if (!row) throw new Error(`mcpTestApp: no user ${userId}`);
    return signToken(row);
  }

  function keyFor(userId, name = "test") {
    return createKey(userId, name).plain;
  }

  async function close() {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(() => resolve()));
    fs.rmSync(dataDir, { recursive: true, force: true, maxRetries: 3 });
  }

  return { app, port, close, dataDir, jwtFor, keyFor };
}

/** A connected MCP client for the test app; close it with `client.close()`. */
export async function mcpClient(port, bearer) {
  const client = new Client({ name: "mcp-test", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${port}/api/mcp`), {
    requestInit: { headers: { Authorization: `Bearer ${bearer}` } },
  });
  await client.connect(transport);
  return client;
}
