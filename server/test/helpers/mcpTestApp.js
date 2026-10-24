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
  const { requireVerifiedEmail } = await import("../../src/middleware/requireVerifiedEmail.js");
  const { withUserScope } = await import("../../src/middleware/userScope.js");
  const { default: authRouter } = await import("../../src/routes/auth.js");
  const { default: billingRouter } = await import("../../src/routes/billing.js");
  const { default: jobsRouter } = await import("../../src/routes/jobs.js");
  const { default: musicRouter } = await import("../../src/routes/music.js");
  const { default: mediaRouter } = await import("../../src/routes/media.js");
  const { default: videogenRouter } = await import("../../src/routes/videogen.js");
  const { default: postizRouter } = await import("../../src/routes/postiz.js");
  const { default: renderRouter, isQuotaFreeRenderRequest } = await import("../../src/routes/render.js");
  const { default: socialRouter } = await import("../../src/routes/social.js");
  const { default: agentKeysRouter } = await import("../../src/routes/agentKeys.js");
  const { quota } = await import("../../src/middleware/quota.js");
  const { default: scriptsRouter } = await import("../../src/routes/scripts.js");
  const { default: bibleRouter } = await import("../../src/routes/bible.js");
  const { default: ttsRouter } = await import("../../src/routes/tts.js");
  const { default: transcriptsRouter } = await import("../../src/routes/transcripts.js");
  const { default: audioRouter } = await import("../../src/routes/audio.js");
  const { default: audioAdvancedRouter } = await import("../../src/routes/audio_advanced.js");
  const { default: libraryRouter } = await import("../../src/routes/library.js");
  const { default: imagegenRouter } = await import("../../src/routes/imagegen.js");
  const { default: brandingRouter } = await import("../../src/routes/branding.js");
  const { default: pexelsRouter } = await import("../../src/routes/pexels.js");
  const { default: pixabayRouter } = await import("../../src/routes/pixabay.js");
  const { createVisualLibraryRouter } = await import("../../src/routes/visualLibrary.js");
  const { requireSuperAdmin } = await import("../../src/middleware/requireSuperAdmin.js");
  const { refuseAgentCalls } = await import("../../src/middleware/agentAuth.js");
  const { createMcpRouter } = await import("../../src/mcp/transport.js");
  const { createKey } = await import("../../src/lib/agentKeys/store.js");

  const app = express();
  app.use(express.json({ limit: "25mb" }));
  app.use("/api/auth", authRouter);
  app.use("/api/billing", billingRouter);
  app.use("/api/jobs", requireAuth, withUserScope, jobsRouter);
  app.use("/api/music", requireAuth, withUserScope, musicRouter);
  app.use("/api/media", requireAuth, withUserScope, mediaRouter);
  app.use("/api/video-gen", requireAuth, withUserScope, requireVerifiedEmail, videogenRouter);
  app.use("/api/postiz", requireAuth, withUserScope, requireVerifiedEmail, postizRouter);
  app.use("/api/render", requireAuth, withUserScope, requireVerifiedEmail, quota("render", { skip: isQuotaFreeRenderRequest }), renderRouter);
  app.use("/api/social", requireAuth, withUserScope, requireVerifiedEmail, socialRouter);
  app.use("/api/scripts", requireAuth, withUserScope, requireVerifiedEmail, quota("scripts"), scriptsRouter);
  app.use("/api/bible", requireAuth, withUserScope, bibleRouter);
  app.use("/api/tts", requireAuth, withUserScope, requireVerifiedEmail, quota("tts"), ttsRouter);
  app.use("/api/transcripts", requireAuth, withUserScope, transcriptsRouter);
  app.use("/api/audio", requireAuth, withUserScope, requireVerifiedEmail, audioRouter);
  app.use("/api/audio-adv", requireAuth, withUserScope, requireVerifiedEmail, audioAdvancedRouter);
  app.use("/api/library", requireAuth, withUserScope, libraryRouter);
  app.use("/api/imagegen", requireAuth, withUserScope, requireVerifiedEmail, imagegenRouter);
  app.use("/api/branding", requireAuth, withUserScope, brandingRouter);
  app.use("/api/pexels", requireAuth, withUserScope, requireVerifiedEmail, pexelsRouter);
  app.use("/api/pixabay", requireAuth, withUserScope, requireVerifiedEmail, pixabayRouter);
  app.use("/api/visual-library", requireAuth, withUserScope, requireVerifiedEmail, requireSuperAdmin, createVisualLibraryRouter());
  // STUB: index.js's real /api/health shells out to ffmpeg; tools only need its shape.
  app.get("/api/health", (_req, res) => {
    res.json({
      ok: true,
      ts: new Date().toISOString(),
      uptimeSec: 1,
      system: { ffmpeg: "test", platform: process.platform, node: process.version },
      capabilities: { elevenlabs: false, openai: false },
    });
  });
  app.use("/api/mcp", createMcpRouter());
  app.use("/api/agent-keys", requireAuth, withUserScope, refuseAgentCalls, agentKeysRouter);

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
