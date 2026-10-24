import fs from "fs";
import path from "path";
import { stringify } from "csv-stringify/sync";
import { DATA_DIR } from "../paths.js";

/**
 * Per-call activity log for the MCP endpoint.
 *
 * Layout: DATA_DIR/agent-activity/<YYYY-MM-DD>.jsonl (UTC day, one JSON object per line).
 * Tool inputs are redacted before they are written.
 */

const ACTIVITY_DIR = path.join(DATA_DIR, "agent-activity");
const DAY_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const KEY_EVENTS = new Set(["created", "revoked", "publish_on", "publish_off", "caps_changed"]);
const SECRET_KEYS = new Set(["authorization", "token", "key", "apikey", "api_key", "password", "secret"]);
const MAX_TEXT = 200;
const MAX_DEPTH = 4;
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const CSV_COLUMNS = ["ts", "keyId", "keyName", "userId", "email", "tool", "ok", "error", "ms", "jobKind", "jobId"];

let clock = () => new Date();

/** Test seam: `_setClock(() => new Date(...))`; `_setClock(null)` restores the real clock. */
export function _setClock(fn) {
  clock = typeof fn === "function" ? fn : () => new Date();
}

const dayOf = (date) => date.toISOString().slice(0, 10);

export function redactInput(input, depth = 0) {
  if (typeof input === "string") {
    return input.length > MAX_TEXT ? `${input.slice(0, MAX_TEXT)}…` : input;
  }
  if (input === null || typeof input !== "object") return input;
  if (ArrayBuffer.isView(input) || input instanceof ArrayBuffer) return "<bytes>";
  if (depth >= MAX_DEPTH) return "<nested>";
  if (Array.isArray(input)) return input.map((item) => redactInput(item, depth + 1));
  const out = {};
  for (const [name, value] of Object.entries(input)) {
    if (SECRET_KEYS.has(name.toLowerCase())) continue;
    out[name] = redactInput(value, depth + 1);
  }
  return out;
}

function append(record) {
  const now = clock();
  const line = JSON.stringify({ ts: now.toISOString(), ...record });
  fs.mkdirSync(ACTIVITY_DIR, { recursive: true });
  fs.appendFileSync(path.join(ACTIVITY_DIR, `${dayOf(now)}.jsonl`), `${line}\n`);
}

export function logActivity(entry) {
  append({
    keyId: entry.keyId ?? null,
    keyName: entry.keyName ?? null,
    userId: entry.userId ?? null,
    email: entry.email ?? null,
    tool: entry.tool,
    input: redactInput(entry.input),
    ok: Boolean(entry.ok),
    error: entry.error ?? null,
    ms: entry.ms ?? 0,
    job: entry.job ?? null,
    caps: entry.caps ?? {},
  });
}

export function logKeyEvent(userId, keyId, event, detail = {}) {
  if (!KEY_EVENTS.has(event)) throw new Error(`activity: unknown key event ${event}`);
  append({
    keyId,
    keyName: null,
    userId,
    email: null,
    tool: `key:${event}`,
    input: redactInput(detail),
    ok: true,
    error: null,
    ms: 0,
    job: null,
    caps: {},
  });
}

function listDayFiles() {
  try {
    return fs.readdirSync(ACTIVITY_DIR).flatMap((name) => {
      const match = DAY_FILE.exec(name);
      return match ? [{ name, day: match[1] }] : [];
    });
  } catch {
    return [];
  }
}

function parseLines(name) {
  const entries = [];
  const text = fs.readFileSync(path.join(ACTIVITY_DIR, name), "utf-8");
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      entries.push(JSON.parse(line));
    } catch {
      console.warn(`[MCP] activity: skipped a bad line in ${name}`);
    }
  }
  return entries;
}

export function readActivity({ userId, keyId, from, to, limit = DEFAULT_LIMIT } = {}) {
  const toDay = to || dayOf(clock());
  const fromDay = from || dayOf(new Date(new Date(`${toDay}T00:00:00Z`).getTime() - 30 * DAY_MS));
  const max = Number.isFinite(limit) && limit > 0 ? Math.min(Math.floor(limit), MAX_LIMIT) : DEFAULT_LIMIT;

  return listDayFiles()
    .filter(({ day }) => day >= fromDay && day <= toDay)
    .flatMap(({ name }) => parseLines(name))
    .filter((e) => (userId === undefined || e.userId === userId) && (keyId === undefined || e.keyId === keyId))
    .sort((a, b) => (a.ts < b.ts ? 1 : a.ts > b.ts ? -1 : 0))
    .slice(0, max);
}

export function activityCsv(entries) {
  const rows = entries.map((e) => ({
    ts: e.ts,
    keyId: e.keyId,
    keyName: e.keyName,
    userId: e.userId,
    email: e.email,
    tool: e.tool,
    ok: e.ok,
    error: e.error,
    ms: e.ms,
    jobKind: e.job?.kind ?? "",
    jobId: e.job?.id ?? "",
  }));
  return stringify(rows, { header: true, columns: CSV_COLUMNS, cast: { boolean: String } });
}

export function pruneActivity(days = 90) {
  const cutoff = dayOf(new Date(clock().getTime() - days * DAY_MS));
  let removed = 0;
  for (const { name, day } of listDayFiles()) {
    if (day >= cutoff) continue;
    fs.rmSync(path.join(ACTIVITY_DIR, name), { force: true });
    removed += 1;
  }
  return removed;
}
