import { getUsersStore } from "../auth.js";
import { findByPlainKey, toPublic } from "../lib/agentKeys/store.js";

const KEY_PREFIX = "bfk_";

function keyInvalid(res) {
  return res.status(401).json({ ok: false, error: "AGENT_KEY_INVALID" });
}

/** Resolves a plain agent key to { user, key }, or null. Throws if a store is unreadable. */
function resolveAgentKey(plain) {
  const record = findByPlainKey(plain);
  if (!record) return null;
  const row = (getUsersStore().users || []).find((u) => u.id === record.userId);
  if (!row) return null;
  return {
    user: {
      sub: row.id,
      email: row.email,
      role: row.role,
      emailVerified: Boolean(row.emailVerified),
      via: "agent-key",
    },
    key: toPublic(record),
  };
}

const KEY_REQUIRED = {
  ok: false,
  error: "AGENT_KEY_REQUIRED",
  message: "Connect with an agent key from Settings → Connected agents.",
};

/**
 * Auth for the MCP endpoint only: an agent key (`bfk_...`) taken from the
 * Authorization header alone (there is deliberately no ?token= fallback).
 * Any other bearer, an app JWT included, is refused: the app's own session
 * never drives the MCP surface (ruling R25).
 */
export function requireAgentKey(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });
  if (!token.startsWith(KEY_PREFIX)) return res.status(401).json(KEY_REQUIRED);

  let resolved;
  try {
    resolved = resolveAgentKey(token);
  } catch (err) {
    console.warn("[MCP] key lookup failed:", err?.message || String(err));
    return keyInvalid(res);
  }
  if (!resolved) return keyInvalid(res);
  req.user = resolved.user;
  req.agentKey = resolved.key;
  return next();
}

/**
 * Backstop for account routes: internal MCP tokens and agent keys never act
 * on them. Safe before or after requireAuth (no user yet means nothing to refuse).
 */
export function refuseAgentCalls(req, res, next) {
  const via = req.user?.via;
  if (via === "mcp" || via === "agent-key") {
    return res.status(403).json({ ok: false, error: "AGENT_FORBIDDEN" });
  }
  return next();
}
