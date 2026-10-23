import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-caps-"));
process.env.DATA_DIR = dir;

const usageFile = path.join(dir, "agent-keys-usage.json");
const caps = await import("./caps.js");

const ENV_NAMES = [
  "MCP_DAILY_RENDERS",
  "MCP_DAILY_AI_VIDEO_USD",
  "MCP_DAILY_IMAGES",
  "MCP_DAILY_TTS",
  "MCP_DAILY_PUBLISHES",
];

function clearEnv() {
  for (const name of ENV_NAMES) delete process.env[name];
}

function keyWith(capValues) {
  return { id: "k_1", userId: "u_1", caps: capValues };
}

beforeEach(() => {
  clearEnv();
  fs.rmSync(usageFile, { force: true });
  caps._setClock(() => "2026-01-01");
});

after(() => {
  clearEnv();
  caps._setClock(null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test("ceilings read env with the spec defaults", () => {
  assert.deepEqual(caps.ceilings(), {
    renders: 10,
    aiVideoUsd: 2,
    images: 30,
    tts: 30,
    publishes: 3,
  });
  process.env.MCP_DAILY_RENDERS = "4";
  process.env.MCP_DAILY_AI_VIDEO_USD = "0.5";
  assert.equal(caps.ceilings().renders, 4);
  assert.equal(caps.ceilings().aiVideoUsd, 0.5);
  process.env.MCP_DAILY_IMAGES = "nope";
  process.env.MCP_DAILY_TTS = "-5";
  assert.equal(caps.ceilings().images, 30);
  assert.equal(caps.ceilings().tts, 30);
});

test("a lower per-key cap wins; a higher one does not", () => {
  assert.equal(caps.effectiveCaps(keyWith({ renders: 3 })).renders, 3);
  assert.equal(caps.effectiveCaps(keyWith({ renders: 50 })).renders, 10);
  assert.equal(caps.effectiveCaps(keyWith({ renders: 3 })).images, 30);
  assert.equal(caps.effectiveCaps(keyWith({ bogus: 1 })).bogus, undefined);
  assert.deepEqual(caps.effectiveCaps(null), caps.ceilings());
});

test("charge counts up to the limit then refuses with resetsAt", async () => {
  const key = keyWith({ renders: 2 });
  assert.deepEqual(await caps.charge("k_1", key, "renders"), { ok: true, used: 1, limit: 2 });
  assert.deepEqual(await caps.charge("k_1", key, "renders"), { ok: true, used: 2, limit: 2 });
  const refused = await caps.charge("k_1", key, "renders");
  assert.equal(refused.ok, false);
  assert.equal(refused.used, 2);
  assert.equal(refused.limit, 2);
  assert.equal(refused.resetsAt, "2026-01-02T00:00:00.000Z");
  assert.match(refused.resetsAt, /T00:00:00\.000Z$/);
  assert.equal(caps.readKeyUsage("k_1").counts.renders, 2);
});

test("fractional aiVideoUsd charges accumulate", async () => {
  const key = keyWith({});
  assert.equal((await caps.charge("k_1", key, "aiVideoUsd", 0.9)).ok, true);
  assert.equal((await caps.charge("k_1", key, "aiVideoUsd", 0.9)).ok, true);
  const refused = await caps.charge("k_1", key, "aiVideoUsd", 0.9);
  assert.equal(refused.ok, false);
  assert.equal(refused.limit, 2);
  assert.ok(Math.abs(refused.used - 1.8) < 1e-9);
});

test("counters roll over at the UTC day boundary", async () => {
  const key = keyWith({ renders: 1 });
  assert.equal((await caps.charge("k_1", key, "renders")).ok, true);
  assert.equal((await caps.charge("k_1", key, "renders")).ok, false);
  caps._setClock(() => "2026-01-02");
  assert.equal(caps.readKeyUsage("k_1").day, "2026-01-02");
  assert.equal(caps.readKeyUsage("k_1").counts.renders, 0);
  assert.equal((await caps.charge("k_1", key, "renders")).ok, true);
  assert.equal(caps.readKeyUsage("k_1").counts.renders, 1);
});

test("ten concurrent charges count ten", async () => {
  const key = keyWith({});
  const results = await Promise.all(
    Array.from({ length: 10 }, () => caps.charge("k_1", key, "images")),
  );
  assert.ok(results.every((r) => r.ok));
  assert.equal(caps.readKeyUsage("k_1").counts.images, 10);
});

test("a super-admin key is capped like any other", async () => {
  const key = { id: "k_admin", userId: "u_admin", role: "super_admin", plan: "premium", caps: {} };
  assert.deepEqual(caps.effectiveCaps(key), caps.ceilings());
  process.env.MCP_DAILY_PUBLISHES = "1";
  assert.equal((await caps.charge("k_admin", key, "publishes")).ok, true);
  const refused = await caps.charge("k_admin", key, "publishes");
  assert.equal(refused.ok, false);
  assert.equal(refused.limit, 1);
});

test("capsSummary reports used, limit and remaining; unknown bucket throws", async () => {
  const key = keyWith({ tts: 5 });
  await caps.charge("k_1", key, "tts", 2);
  const summary = caps.capsSummary("k_1", key);
  assert.deepEqual(summary.tts, { used: 2, limit: 5, remaining: 3 });
  assert.deepEqual(summary.renders, { used: 0, limit: 10, remaining: 10 });
  await assert.rejects(() => caps.charge("k_1", key, "nope"), /caps: unknown bucket nope/);
});
