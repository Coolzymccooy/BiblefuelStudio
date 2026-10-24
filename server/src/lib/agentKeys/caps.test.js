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

test("a refused charge leaves the file on disk unchanged", async () => {
  const key = keyWith({ renders: 1 });
  await caps.charge("k_1", key, "renders");
  const before = fs.readFileSync(usageFile, "utf-8");
  assert.equal((await caps.charge("k_1", key, "renders")).ok, false);
  assert.equal(fs.readFileSync(usageFile, "utf-8"), before);
});

test("charge rejects a non-finite, zero or negative amount and leaves the count alone", async () => {
  await caps.charge("k_1", null, "images", 2);
  const before = fs.readFileSync(usageFile, "utf-8");
  await assert.rejects(() => caps.charge("k_1", null, "images", NaN), /caps: invalid amount NaN/);
  await assert.rejects(() => caps.charge("k_1", null, "images", -1), /caps: invalid amount -1/);
  await assert.rejects(() => caps.charge("k_1", null, "images", 0), /caps: invalid amount 0/);
  await assert.rejects(() => caps.charge("k_1", null, "images", Infinity), /caps: invalid amount/);
  assert.equal(caps.readKeyUsage("k_1").counts.images, 2);
  assert.equal(fs.readFileSync(usageFile, "utf-8"), before);
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

test("twenty charges of 0.1 fit a limit of 2 despite float drift; the next is refused", async () => {
  process.env.MCP_DAILY_AI_VIDEO_USD = "2";
  const key = keyWith({});
  for (let i = 0; i < 20; i += 1) {
    const result = await caps.charge("k_1", key, "aiVideoUsd", 0.1);
    assert.equal(result.ok, true, `charge ${i + 1} should succeed`);
  }
  assert.equal((await caps.charge("k_1", key, "aiVideoUsd", 0.1)).ok, false);
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

test("two keys of one user together cannot exceed the ceiling (scope user)", async () => {
  process.env.MCP_DAILY_RENDERS = "3";
  const keyA = { id: "k_a", userId: "u_1", caps: {} };
  const keyB = { id: "k_b", userId: "u_1", caps: {} };
  assert.equal((await caps.charge("k_a", keyA, "renders")).ok, true);
  assert.equal((await caps.charge("k_a", keyA, "renders")).ok, true);
  assert.equal((await caps.charge("k_b", keyB, "renders")).ok, true);
  const before = fs.readFileSync(usageFile, "utf-8");
  const refused = await caps.charge("k_b", keyB, "renders");
  assert.deepEqual(refused, {
    ok: false,
    scope: "user",
    used: 3,
    limit: 3,
    resetsAt: "2026-01-02T00:00:00.000Z",
  });
  assert.equal(fs.readFileSync(usageFile, "utf-8"), before, "a refusal writes neither counter");
  assert.equal(caps.readKeyUsage("k_b").counts.renders, 1);
  assert.equal(caps.readUserUsage("u_1").counts.renders, 3);
});

test("another user's keys do not share the account counter", async () => {
  process.env.MCP_DAILY_RENDERS = "1";
  assert.equal((await caps.charge("k_a", { id: "k_a", userId: "u_1", caps: {} }, "renders")).ok, true);
  assert.equal((await caps.charge("k_z", { id: "k_z", userId: "u_2", caps: {} }, "renders")).ok, true);
});

test("a lower per-key cap still refuses first with scope key", async () => {
  process.env.MCP_DAILY_RENDERS = "2";
  const low = { id: "k_low", userId: "u_1", caps: { renders: 1 } };
  const other = { id: "k_other", userId: "u_1", caps: {} };
  assert.equal((await caps.charge("k_low", low, "renders")).ok, true);
  const keyRefusal = await caps.charge("k_low", low, "renders");
  assert.equal(keyRefusal.ok, false);
  assert.equal(keyRefusal.scope, "key");
  assert.equal(keyRefusal.limit, 1);

  // Both counters full: the key's own cap is still the one reported.
  assert.equal((await caps.charge("k_other", other, "renders")).ok, true);
  const both = await caps.charge("k_low", low, "renders");
  assert.equal(both.scope, "key");
  assert.equal(both.used, 1);
  assert.equal(both.limit, 1);
});

test("a key-scope refusal reports scope key on a plain key cap", async () => {
  const key = keyWith({ tts: 1 });
  await caps.charge("k_1", key, "tts");
  assert.equal((await caps.charge("k_1", key, "tts")).scope, "key");
});

test("the account counter rolls over at UTC midnight", async () => {
  process.env.MCP_DAILY_PUBLISHES = "1";
  const keyA = { id: "k_a", userId: "u_1", caps: {} };
  const keyB = { id: "k_b", userId: "u_1", caps: {} };
  assert.equal((await caps.charge("k_a", keyA, "publishes")).ok, true);
  assert.equal((await caps.charge("k_b", keyB, "publishes")).scope, "user");
  caps._setClock(() => "2026-01-02");
  assert.equal(caps.readUserUsage("u_1").counts.publishes, 0);
  assert.equal((await caps.charge("k_b", keyB, "publishes")).ok, true);
  assert.equal(caps.readUserUsage("u_1").counts.publishes, 1);
});

test("accountCapsSummary reports the account's use against the ceilings", async () => {
  process.env.MCP_DAILY_TTS = "4";
  await caps.charge("k_a", { id: "k_a", userId: "u_1", caps: { tts: 1 } }, "tts");
  await caps.charge("k_b", { id: "k_b", userId: "u_1", caps: {} }, "tts", 2);
  const summary = caps.accountCapsSummary("u_1");
  assert.deepEqual(summary.tts, { used: 3, limit: 4, remaining: 1 });
  assert.deepEqual(summary.renders, { used: 0, limit: 10, remaining: 10 });
  assert.deepEqual(caps.capsSummary("k_b", { id: "k_b", userId: "u_1", caps: {} }).tts, { used: 2, limit: 4, remaining: 2 });
});
