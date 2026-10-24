import { Router } from "express";
import { getUsersStore } from "../auth.js";
import { activityCsv, activityToday, queryActivity } from "../lib/agentKeys/activity.js";

/**
 * GET /api/admin/agent-activity: every agent call across all users, for the
 * Admin "Agent activity" tab. Mounted inside the admin router, so it sits
 * behind requireAuth, refuseAgentCalls and requireSuperAdmin.
 *
 * Query: from, to (YYYY-MM-DD, inclusive; default the last 7 days, at most 31),
 * userId, keyId, tool, ok ("true" | "false"), limit (default 200, max 1000),
 * format=csv for a CSV of every filtered row.
 */
const router = Router();

const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_DAYS = 7;
const MAX_DAYS = 31;
const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 1000;

const dayMs = (day) => Date.parse(`${day}T00:00:00Z`);
// A real calendar day: 2026-02-30 parses (and rolls over) in some engines, so it must round-trip.
const isDay = (value) =>
  typeof value === "string" &&
  DAY.test(value) &&
  !Number.isNaN(dayMs(value)) &&
  new Date(dayMs(value)).toISOString().slice(0, 10) === value;
const shiftDay = (day, days) => new Date(dayMs(day) + days * DAY_MS).toISOString().slice(0, 10);
const text = (value) => (typeof value === "string" && value.trim() ? value.trim() : undefined);

class BadQuery extends Error {
  constructor(code, hint) {
    super(code);
    this.code = code;
    this.hint = hint;
  }
}

function readRange(query) {
  for (const day of [query.from, query.to]) {
    if (day !== undefined && !isDay(day)) throw new BadQuery("BAD_DATE", "Dates must look like 2026-10-23.");
  }
  const to = query.to || activityToday();
  const from = query.from || shiftDay(to, -(DEFAULT_DAYS - 1));
  if (from > to) throw new BadQuery("BAD_RANGE", "from must be on or before to.");
  if ((dayMs(to) - dayMs(from)) / DAY_MS + 1 > MAX_DAYS) {
    throw new BadQuery("RANGE_TOO_LONG", `Pick at most ${MAX_DAYS} days.`);
  }
  return { from, to };
}

function readOk(raw) {
  if (raw === undefined || raw === "") return undefined;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new BadQuery("BAD_OK", 'ok must be "true" or "false".');
}

function readLimit(raw) {
  const asked = Number(raw);
  return Number.isFinite(asked) && asked >= 1 ? Math.min(Math.floor(asked), MAX_LIMIT) : DEFAULT_LIMIT;
}

/** @returns {{ from, to, userId?, keyId?, tool?, ok?, limit }} or throws BadQuery */
function readFilters(query) {
  return {
    ...readRange(query),
    userId: text(query.userId),
    keyId: text(query.keyId),
    tool: text(query.tool),
    ok: readOk(query.ok),
    limit: readLimit(query.limit),
  };
}

/**
 * Fills `counts.emails` for users whose rows carry no email (key events never do)
 * from users.json, read once and only when needed. A failed read leaves them null.
 */
function withStoredEmails(counts) {
  const missing = Object.keys(counts.emails).filter((id) => !counts.emails[id]);
  if (missing.length === 0) return counts;
  let users;
  try {
    users = getUsersStore()?.users;
  } catch (err) {
    console.warn("[ADMIN] agent activity: users store unreadable:", err?.message || String(err));
    return counts;
  }
  const byId = new Map((Array.isArray(users) ? users : []).map((u) => [u?.id, u?.email]));
  const found = missing.map((id) => [id, byId.get(id) || null]);
  return { ...counts, emails: { ...counts.emails, ...Object.fromEntries(found) } };
}

router.get("/", (req, res) => {
  let filters;
  try {
    filters = readFilters(req.query || {});
  } catch (err) {
    if (err instanceof BadQuery) return res.status(400).json({ ok: false, error: err.code, hint: err.hint });
    throw err;
  }
  try {
    const { rows, counts, total, all } = queryActivity(filters);
    if (req.query.format === "csv") {
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="agent-activity-all.csv"');
      return res.send(activityCsv(all));
    }
    return res.json({ ok: true, rows, counts: withStoredEmails(counts), total });
  } catch (err) {
    console.error("[ADMIN] agent activity failed:", err?.message || String(err));
    return res.status(500).json({ ok: false, error: "ACTIVITY_FAILED" });
  }
});

export default router;
