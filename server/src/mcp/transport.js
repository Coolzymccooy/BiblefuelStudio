import express from "express";
import rateLimit from "express-rate-limit";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { hostHeaderValidation } from "@modelcontextprotocol/sdk/server/middleware/hostHeaderValidation.js";
import { requireAgentKeyOrJwt } from "../middleware/agentAuth.js";
import { isSuperAdmin } from "../lib/userPlan.js";
import { createApi } from "./api.js";
import { buildServer } from "./registry.js";

/**
 * The MCP endpoint: Streamable HTTP, stateless. Each POST gets a fresh
 * McpServer and transport, so nothing is shared between requests or agents.
 * This is the only file that touches SDK transport classes.
 */

// The SDK compares URL hostnames, which keep the brackets on IPv6 literals.
const DEFAULT_HOSTS = ["localhost", "127.0.0.1", "[::1]"];
// Media for the public app is served from its own host (see client/src/lib/api.ts mediaUrl).
const MEDIA_BASES = { "biblefuel.tiwaton.co.uk": "https://media.tiwaton.co.uk" };
const METHOD_NOT_ALLOWED = { jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed." }, id: null };
const INTERNAL_ERROR = { jsonrpc: "2.0", error: { code: -32603, message: "Internal server error" }, id: null };

function splitList(raw) {
  return String(raw || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

function hostOf(origin) {
  if (origin === "*") return null;
  try {
    return new URL(origin.includes("://") ? origin : `http://${origin}`).hostname;
  } catch {
    return null;
  }
}

/** Host names the endpoint answers on (port-agnostic; the SDK check compares hostnames). */
export function allowedHosts(env = process.env) {
  const explicit = splitList(env.MCP_ALLOWED_HOSTS);
  if (explicit.length) return explicit;
  const fromCors = splitList(env.CORS_ORIGIN).map(hostOf).filter(Boolean);
  return [...new Set([...DEFAULT_HOSTS, ...fromCors])];
}

function publicBaseFor(req) {
  const hostname = String(req.hostname || "").toLowerCase();
  return MEDIA_BASES[hostname] || `${req.protocol}://${req.get("host")}`;
}

function contextFor(req) {
  const user = req.user;
  const agentKey = req.agentKey || null;
  const baseUrl = `http://127.0.0.1:${req.socket.localPort}`;
  return {
    user,
    agentKey,
    subjectId: agentKey?.id || `jwt:${user.sub}`,
    isSuperAdmin: isSuperAdmin(user),
    baseUrl,
    publicBase: publicBaseFor(req),
    api: createApi({ user, baseUrl }),
  };
}

// Express 4 does not catch a rejected handler, so every step, building the
// server included, stays inside the try: a bad catalogue must answer 500, not
// take the process down.
async function handleMcpPost(req, res) {
  try {
    const server = buildServer(contextFor(req));
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on("close", () => {
      Promise.all([transport.close(), server.close()]).catch((err) => {
        console.warn("[MCP] close failed:", err?.message || String(err));
      });
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    console.warn("[MCP] request failed:", err?.message || String(err));
    if (!res.headersSent) res.status(500).json(INTERNAL_ERROR);
    else res.end();
  }
}

/** @returns {express.Router} */
export function createMcpRouter() {
  const router = express.Router();
  router.use(hostHeaderValidation(allowedHosts()));
  router.use(
    requireAgentKeyOrJwt,
    rateLimit({
      windowMs: 60_000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
      keyGenerator: (req) => req.agentKey?.id || `jwt:${req.user.sub}`,
      handler: (_req, res) => res.status(429).json({ ok: false, error: "RATE_LIMITED" }),
    }),
  );
  router.post("/", handleMcpPost);
  router.get("/", (_req, res) => res.status(405).json(METHOD_NOT_ALLOWED));
  router.delete("/", (_req, res) => res.status(405).json(METHOD_NOT_ALLOWED));
  return router;
}
