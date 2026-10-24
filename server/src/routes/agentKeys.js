import { Router } from "express";
import { createKey, listKeys, revokeKey, updateKey } from "../lib/agentKeys/store.js";
import { CAP_BUCKETS, ceilings, capsSummary } from "../lib/agentKeys/caps.js";
import { activityCsv, logKeyEvent, readActivity } from "../lib/agentKeys/activity.js";

/**
 * Agent key management for the signed-in user. Mounted behind
 * requireAuth, withUserScope and refuseAgentCalls: only a real session may
 * mint, change or revoke the keys agents act with.
 */
const router = Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const MAX_LIMIT = 1000;
const DEFAULT_LIMIT = 50;

const isDay = (value) => DAY.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`));
const fail = (res, status, error, hint) => res.status(status).json({ ok: false, error, ...(hint ? { hint } : {}) });

/** Reads ?keyId&from&to&limit into readActivity filters, or answers 400 and returns null. */
function activityFilters(req, res, fixedLimit) {
  const { keyId, from, to } = req.query;
  for (const day of [from, to]) {
    if (day !== undefined && !(typeof day === "string" && isDay(day))) {
      fail(res, 400, "BAD_DATE", "Dates must look like 2026-10-23.");
      return null;
    }
  }
  const asked = Number(req.query.limit);
  const limit = fixedLimit ?? (Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_LIMIT) : DEFAULT_LIMIT);
  return {
    userId: req.ctx.userId,
    keyId: typeof keyId === "string" && keyId ? keyId : undefined,
    from,
    to,
    limit,
  };
}

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "[::1]"]);

function hostnameOf(host) {
  try { return new URL(`http://${host}`).hostname.toLowerCase(); } catch { return ""; }
}

/**
 * The URL agents should call. Any public host gets https: behind Cloudflare
 * and Traefik the request can reach Express as plain http. Loopback keeps the
 * scheme it came in on, so local development still works.
 */
function mcpEndpoint(req) {
  const host = req.get("host");
  const scheme = LOOPBACK_HOSTS.has(hostnameOf(host)) ? req.protocol : "https";
  return `${scheme}://${host}/api/mcp`;
}

function clampCaps(caps, ceiling) {
  const out = {};
  for (const bucket of CAP_BUCKETS) {
    if (caps[bucket] !== undefined) out[bucket] = Math.min(caps[bucket], ceiling[bucket]);
  }
  return out;
}

const validCaps = (caps) =>
  caps !== null &&
  typeof caps === "object" &&
  !Array.isArray(caps) &&
  Object.values(caps).every((v) => typeof v === "number" && Number.isFinite(v) && v >= 0);

router.get("/", (req, res) => {
  const keys = listKeys(req.ctx.userId).map((key) => ({ ...key, usage: capsSummary(key.id, key) }));
  res.json({ ok: true, endpoint: mcpEndpoint(req), ceilings: ceilings(), keys });
});

router.post("/", (req, res) => {
  const name = req.body?.name;
  if (typeof name !== "string") return fail(res, 400, "KEY_NAME", "Give the key a name of 1 to 60 characters.");
  try {
    const { key, plain } = createKey(req.ctx.userId, name);
    logKeyEvent(req.ctx.userId, key.id, "created", { name: key.name });
    return res.status(201).json({ ok: true, key, plain });
  } catch (err) {
    if (err?.message === "KEY_NAME") return fail(res, 400, "KEY_NAME", "Give the key a name of 1 to 60 characters.");
    if (err?.message === "KEY_LIMIT") return fail(res, 409, "KEY_LIMIT", "You can have 10 keys. Revoke one first.");
    console.error("[agent-keys] create failed:", err?.message || String(err));
    return fail(res, 500, "CREATE_FAILED");
  }
});

router.patch("/:id", (req, res) => {
  const { publishAllowed, caps } = req.body || {};
  if (publishAllowed !== undefined && typeof publishAllowed !== "boolean") {
    return fail(res, 400, "BAD_PUBLISH_ALLOWED", "publishAllowed must be true or false.");
  }
  if (caps !== undefined && !validCaps(caps)) {
    return fail(res, 400, "BAD_CAPS", "Caps must be numbers of 0 or more.");
  }

  const { userId } = req.ctx;
  const before = listKeys(userId).find((k) => k.id === req.params.id);
  if (!before) return fail(res, 404, "NOT_FOUND");

  const clamped = caps === undefined ? undefined : clampCaps(caps, ceilings());
  const key = updateKey(userId, before.id, { publishAllowed, caps: clamped });
  if (!key) return fail(res, 404, "NOT_FOUND");

  if (publishAllowed !== undefined && publishAllowed !== before.publishAllowed) {
    logKeyEvent(userId, key.id, publishAllowed ? "publish_on" : "publish_off");
  }
  if (clamped !== undefined) logKeyEvent(userId, key.id, "caps_changed", { caps: clamped });
  return res.json({ ok: true, key });
});

router.delete("/:id", (req, res) => {
  if (!revokeKey(req.ctx.userId, req.params.id)) return fail(res, 404, "NOT_FOUND");
  logKeyEvent(req.ctx.userId, req.params.id, "revoked");
  return res.json({ ok: true });
});

router.get("/activity", (req, res) => {
  const filters = activityFilters(req, res);
  if (!filters) return undefined;
  return res.json({ ok: true, entries: readActivity(filters) });
});

router.get("/activity.csv", (req, res) => {
  const filters = activityFilters(req, res, MAX_LIMIT);
  if (!filters) return undefined;
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", 'attachment; filename="agent-activity.csv"');
  return res.send(activityCsv(readActivity(filters)));
});

export default router;
