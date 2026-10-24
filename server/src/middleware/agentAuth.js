import jwt from "jsonwebtoken";
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

/**
 * Auth for the MCP endpoint only: an agent key (`bfk_...`) or an app JWT, taken
 * from the Authorization header alone (there is deliberately no ?token= fallback).
 */
export function requireAgentKeyOrJwt(req, res, next) {
  const header = req.headers["authorization"] || "";
  const token = header.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return res.status(401).json({ ok: false, error: "Missing Bearer token" });

  if (token.startsWith(KEY_PREFIX)) {
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

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || "dev_secret_change_me");
    // Same rule as requireAuth: a single-purpose token is never a login.
    if (decoded && typeof decoded === "object" && decoded.purpose) {
      return res.status(401).json({ ok: false, error: "Invalid token" });
    }
    // Internal loopback tokens (via: "mcp") act inside the app only; one
    // presented here would let a leaked 60 s token drive the MCP surface.
    if (decoded && typeof decoded === "object" && decoded.via !== undefined) {
      return res.status(401).json({ ok: false, error: "AGENT_KEY_INVALID", message: "Invalid token" });
    }
    req.user = decoded;
    req.agentKey = null;
    return next();
  } catch {
    return res.status(401).json({ ok: false, error: "Invalid token" });
  }
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
