import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-activity-"));
process.env.DATA_DIR = dir;
const activityDir = path.join(dir, "agent-activity");

const activity = await import("./activity.js");
const { logActivity, logKeyEvent, redactInput, readActivity, activityCsv, pruneActivity, _setClock } = activity;

const originalWarn = console.warn;

function entry(over = {}) {
  return {
    keyId: "k_1",
    keyName: "Claude",
    userId: "u_1",
    email: "one@example.com",
    tool: "list_projects",
    input: { q: "x" },
    ok: true,
    error: null,
    ms: 12,
    job: null,
    caps: {},
    ...over,
  };
}

function at(iso) {
  _setClock(() => new Date(iso));
}

beforeEach(() => {
  fs.rmSync(activityDir, { recursive: true, force: true });
  _setClock(null);
  console.warn = originalWarn;
});

after(() => {
  _setClock(null);
  console.warn = originalWarn;
  fs.rmSync(dir, { recursive: true, force: true });
});

test("logActivity appends a line to today's file with ts", () => {
  at("2026-10-23T09:30:00.000Z");
  logActivity(entry());
  logActivity(entry({ tool: "second" }));

  const file = path.join(activityDir, "2026-10-23.jsonl");
  const lines = fs.readFileSync(file, "utf-8").split("\n");
  assert.equal(lines.length, 3);
  assert.equal(lines[2], "");
  const first = JSON.parse(lines[0]);
  assert.equal(first.ts, "2026-10-23T09:30:00.000Z");
  assert.equal(first.tool, "list_projects");
  assert.deepEqual(first.input, { q: "x" });
  assert.equal(JSON.parse(lines[1]).tool, "second");
});

test("redactInput cuts long text, drops secret-looking keys, replaces bytes", () => {
  const cut = redactInput("a".repeat(300));
  assert.equal(cut.length, 201);
  assert.ok(cut.endsWith("…"));
  assert.equal(redactInput("short"), "short");

  assert.deepEqual(redactInput({ token: "x", text: "y" }), { text: "y" });
  assert.deepEqual(
    redactInput({ Authorization: "a", API_KEY: "b", apiKey: "c", Password: "d", secret: "e", key: "f", keep: 1 }),
    { keep: 1 },
  );

  assert.equal(redactInput(Buffer.from("abc")), "<bytes>");
  assert.equal(redactInput(new Uint8Array(4)), "<bytes>");
  assert.equal(redactInput(new ArrayBuffer(4)), "<bytes>");

  assert.deepEqual(redactInput([{ token: "x", n: 2 }, null, true, 3]), [{ n: 2 }, null, true, 3]);

  const deep = { a: { b: { c: { d: { e: 1 } } } } };
  assert.deepEqual(redactInput(deep), { a: { b: { c: { d: "<nested>" } } } });
});

test("readActivity filters by user and key, newest first, limit", () => {
  at("2026-10-22T10:00:00.000Z");
  logActivity(entry({ tool: "a" }));
  at("2026-10-23T08:00:00.000Z");
  logActivity(entry({ tool: "b", keyId: "k_2" }));
  at("2026-10-23T09:00:00.000Z");
  logActivity(entry({ tool: "c", userId: "u_2", keyId: "k_3" }));
  at("2026-10-23T10:00:00.000Z");
  logActivity(entry({ tool: "d" }));

  assert.deepEqual(readActivity({}).map((e) => e.tool), ["d", "c", "b", "a"]);
  assert.deepEqual(readActivity({ userId: "u_1" }).map((e) => e.tool), ["d", "b", "a"]);
  assert.deepEqual(readActivity({ keyId: "k_2" }).map((e) => e.tool), ["b"]);
  assert.deepEqual(readActivity({ limit: 2 }).map((e) => e.tool), ["d", "c"]);
  assert.deepEqual(
    readActivity({ from: "2026-10-23", to: "2026-10-23" }).map((e) => e.tool),
    ["d", "c", "b"],
  );
  assert.deepEqual(readActivity({ to: "2026-10-22" }).map((e) => e.tool), ["a"]);
});

test("readActivity skips unparsable lines with a warning", () => {
  at("2026-10-23T08:00:00.000Z");
  logActivity(entry({ tool: "good" }));
  fs.appendFileSync(path.join(activityDir, "2026-10-23.jsonl"), "{not json\n");

  const warnings = [];
  console.warn = (msg) => warnings.push(msg);
  const out = readActivity({});
  assert.deepEqual(out.map((e) => e.tool), ["good"]);
  assert.deepEqual(warnings, ["[MCP] activity: skipped a bad line in 2026-10-23.jsonl"]);
});

test("logKeyEvent writes a key: entry and rejects unknown events", () => {
  at("2026-10-23T08:00:00.000Z");
  logKeyEvent("u_1", "k_1", "created", { name: "Claude" });
  const [e] = readActivity({});
  assert.equal(e.tool, "key:created");
  assert.equal(e.userId, "u_1");
  assert.equal(e.keyId, "k_1");
  assert.equal(e.ok, true);
  assert.deepEqual(e.input, { name: "Claude" });
  assert.throws(() => logKeyEvent("u_1", "k_1", "exploded"), /activity: unknown key event exploded/);
});

test("activityCsv has the header row and one row per entry", () => {
  const csv = activityCsv([
    { ts: "2026-10-23T08:00:00.000Z", ...entry({ tool: "render", job: { kind: "story", id: "j1" }, ms: 5 }) },
    { ts: "2026-10-23T09:00:00.000Z", ...entry({ ok: false, error: "boom, bad", job: null }) },
  ]);
  const lines = csv.trim().split("\n");
  assert.equal(lines[0], "ts,keyId,keyName,userId,email,tool,ok,error,ms,jobKind,jobId");
  assert.equal(lines.length, 3);
  assert.ok(lines[1].endsWith(",render,true,,5,story,j1"));
  assert.ok(lines[2].includes('"boom, bad"'));
  assert.equal(activityCsv([]).trim(), "ts,keyId,keyName,userId,email,tool,ok,error,ms,jobKind,jobId");
});

test("pruneActivity removes files older than 90 days and keeps the rest", () => {
  at("2026-10-23T08:00:00.000Z");
  fs.mkdirSync(activityDir, { recursive: true });
  fs.writeFileSync(path.join(activityDir, "2026-01-01.jsonl"), "{}\n");
  fs.writeFileSync(path.join(activityDir, "2026-10-23.jsonl"), "{}\n");
  fs.writeFileSync(path.join(activityDir, "notes.txt"), "keep");

  assert.equal(pruneActivity(), 1);
  assert.deepEqual(fs.readdirSync(activityDir).sort(), ["2026-10-23.jsonl", "notes.txt"]);
  assert.equal(pruneActivity(), 0);

  fs.rmSync(activityDir, { recursive: true, force: true });
  assert.equal(pruneActivity(), 0);
});

test("readActivity filters by tool and outcome", () => {
  at("2026-10-23T08:00:00.000Z");
  logActivity(entry({ tool: "render" }));
  at("2026-10-23T08:01:00.000Z");
  logActivity(entry({ tool: "render", ok: false, error: "MCP_CAP_REACHED: x" }));
  at("2026-10-23T08:02:00.000Z");
  logActivity(entry({ tool: "whoami" }));

  assert.deepEqual(readActivity({ tool: "render" }).map((e) => e.ok), [false, true]);
  assert.deepEqual(readActivity({ ok: false }).map((e) => e.tool), ["render"]);
  assert.deepEqual(readActivity({ ok: true }).map((e) => e.tool), ["whoami", "render"]);
});

test("queryActivity returns the newest rows, counts over every match and the total", () => {
  at("2026-10-23T08:00:00.000Z");
  logActivity(entry({ tool: "render", email: "one@example.com" }));
  at("2026-10-23T08:01:00.000Z");
  logActivity(entry({ tool: "render", ok: false, error: "boom", email: "one@example.com" }));
  at("2026-10-23T08:02:00.000Z");
  logActivity(entry({ tool: "whoami", userId: "u_2", email: "two@example.com" }));
  at("2026-10-23T08:03:00.000Z");
  logKeyEvent("u_2", "k_9", "created", { name: "Codex" });

  const result = activity.queryActivity({ from: "2026-10-23", to: "2026-10-23", limit: 2 });
  assert.equal(result.total, 4);
  assert.deepEqual(result.rows.map((e) => e.tool), ["key:created", "whoami"]);
  assert.deepEqual(result.counts.byTool, {
    render: { calls: 2, errors: 1 },
    whoami: { calls: 1, errors: 0 },
    "key:created": { calls: 1, errors: 0 },
  });
  // A key event carries no email: it is counted under the user id.
  assert.deepEqual(result.counts.byUser, {
    "one@example.com": { calls: 2, errors: 1 },
    "two@example.com": { calls: 1, errors: 0 },
    u_2: { calls: 1, errors: 0 },
  });

  const filtered = activity.queryActivity({ from: "2026-10-23", to: "2026-10-23", tool: "render", ok: false });
  assert.equal(filtered.total, 1);
  assert.deepEqual(filtered.counts.byTool, { render: { calls: 1, errors: 1 } });
});

test("activityCsv prefixes cells that a spreadsheet would run as a formula", () => {
  const risky = ["=HYPERLINK(\"x\")", "+1", "-2", "@SUM(A1)", "\tlead"];
  const csv = activityCsv(
    risky.map((text, i) => ({ ts: `2026-10-23T08:0${i}:00.000Z`, ...entry({ tool: text, keyName: text, error: text, ok: false }) })),
  );
  const rows = csv.trim().split("\n").slice(1);
  assert.equal(rows.length, risky.length);
  assert.ok(rows[0].includes(`"'=HYPERLINK(""x"")"`), rows[0]);
  assert.ok(rows[1].includes(",'+1,"), rows[1]);
  assert.ok(rows[2].includes(",'-2,"), rows[2]);
  assert.ok(rows[3].includes(",'@SUM(A1),"), rows[3]);
  assert.ok(rows[4].includes("'\tlead"), rows[4]);
  assert.ok(!/,[=+\-@]/.test(rows.join("\n").replace(/,'[=+\-@]/g, "")), "no bare formula cell left");
  // Ordinary values are untouched.
  const plain = activityCsv([{ ts: "2026-10-23T08:00:00.000Z", ...entry({ tool: "render", ms: 5 }) }]);
  assert.ok(plain.trim().split("\n")[1].startsWith("2026-10-23T08:00:00.000Z,k_1,Claude,u_1,one@example.com,render,true,,5"));
});
