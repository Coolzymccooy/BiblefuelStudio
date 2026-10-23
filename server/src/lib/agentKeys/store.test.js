import { test, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "agent-keys-"));
process.env.DATA_DIR = dir;

const USERS = [
  { id: "u_1", email: "one@example.com", role: "user", emailVerified: true },
  { id: "u_2", email: "two@example.com", role: "user", emailVerified: true },
];
const usersFile = path.join(dir, "users.json");
const keysFile = path.join(dir, "agent-keys.json");

function writeUsers(users) {
  fs.writeFileSync(usersFile, JSON.stringify({ users }, null, 2));
}

const store = await import("./store.js");

beforeEach(() => {
  writeUsers(USERS);
  fs.rmSync(keysFile, { force: true });
});

after(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

test("generateKey makes a bfk_ key and its sha256 hex hash", () => {
  const { plain, hash } = store.generateKey();
  assert.match(plain, /^bfk_[A-Za-z0-9_-]{43}$/);
  assert.match(hash, /^[0-9a-f]{64}$/);
  assert.notEqual(store.generateKey().plain, plain);
});

test("createKey returns the plain key once and lists it without the hash", () => {
  const { key, plain } = store.createKey("u_1", "Claude Desktop");
  assert.match(key.id, /^ak_[0-9a-f]{16}$/);
  assert.equal(key.userId, "u_1");
  assert.equal(key.publishAllowed, false);
  assert.equal(key.revokedAt, null);
  assert.equal("hash" in key, false);
  assert.equal(key.prefix, plain.slice(0, 12));

  const listed = store.listKeys("u_1");
  assert.equal(listed.length, 1);
  assert.equal("hash" in listed[0], false);
  assert.equal(listed[0].prefix, plain.slice(0, 12));
  assert.equal(listed[0].publishAllowed, false);
  assert.equal(listed[0].name, "Claude Desktop");

  const onDisk = JSON.parse(fs.readFileSync(keysFile, "utf-8"));
  assert.equal(onDisk.keys.length, 1);
  assert.equal(JSON.stringify(onDisk).includes(plain), false);
  assert.deepEqual(store.listKeys("u_2"), []);
});

test("findByPlainKey finds a live key and ignores a wrong one", () => {
  const { plain } = store.createKey("u_1", "k");
  assert.equal(store.findByPlainKey(plain)?.userId, "u_1");
  assert.equal(store.findByPlainKey("bfk_nope"), null);
  assert.equal(store.findByPlainKey(""), null);
  assert.equal(store.findByPlainKey("not-a-key"), null);
  assert.equal(store.findByPlainKey(undefined), null);
});

test("findByPlainKey throttles lastUsedAt writes to once a minute", () => {
  const { plain, key } = store.createKey("u_1", "k");
  assert.equal(key.lastUsedAt, null);

  const first = store.findByPlainKey(plain);
  assert.ok(first.lastUsedAt);
  const stamped = JSON.parse(fs.readFileSync(keysFile, "utf-8")).keys[0].lastUsedAt;
  assert.equal(stamped, first.lastUsedAt);

  store.findByPlainKey(plain);
  assert.equal(JSON.parse(fs.readFileSync(keysFile, "utf-8")).keys[0].lastUsedAt, stamped);

  const stale = new Date(Date.now() - 61_000).toISOString();
  const data = JSON.parse(fs.readFileSync(keysFile, "utf-8"));
  data.keys[0].lastUsedAt = stale;
  fs.writeFileSync(keysFile, JSON.stringify(data));
  store.findByPlainKey(plain);
  const refreshed = JSON.parse(fs.readFileSync(keysFile, "utf-8")).keys[0].lastUsedAt;
  assert.notEqual(refreshed, stale);
});

test("toPublic strips the hash and adds the prefix", () => {
  const { plain } = store.createKey("u_1", "k");
  const record = store.findByPlainKey(plain);
  const pub = store.toPublic(record);
  assert.equal("hash" in pub, false);
  assert.equal(pub.prefix, plain.slice(0, 12));
  assert.equal(pub.id, record.id);
});

test("revokeKey hides the key from findByPlainKey and listKeys", () => {
  const { key, plain } = store.createKey("u_1", "k");
  assert.equal(store.revokeKey("u_2", key.id), false);
  assert.equal(store.findByPlainKey(plain)?.id, key.id);

  assert.equal(store.revokeKey("u_1", key.id), true);
  assert.equal(store.findByPlainKey(plain), null);
  assert.deepEqual(store.listKeys("u_1"), []);
  assert.equal(store.revokeKey("u_1", key.id), false);
  assert.equal(store.revokeKey("u_1", "ak_missing"), false);
});

test("eleventh live key is refused with KEY_LIMIT", () => {
  for (let i = 0; i < 10; i += 1) store.createKey("u_1", `k${i}`);
  assert.throws(() => store.createKey("u_1", "k10"), { message: "KEY_LIMIT" });
  // Another user is unaffected, and revoking frees a slot.
  store.createKey("u_2", "other");
  store.revokeKey("u_1", store.listKeys("u_1")[0].id);
  assert.doesNotThrow(() => store.createKey("u_1", "k10"));
});

test("a key for a deleted user is not found", () => {
  const { plain } = store.createKey("u_2", "k");
  assert.equal(store.findByPlainKey(plain)?.userId, "u_2");
  writeUsers(USERS.filter((u) => u.id !== "u_2"));
  assert.equal(store.findByPlainKey(plain), null);
});

test("updateKey sets publishAllowed and lower caps", () => {
  const { key } = store.createKey("u_1", "k");
  const updated = store.updateKey("u_1", key.id, { publishAllowed: true, caps: { renders: 3 } });
  assert.equal(updated.publishAllowed, true);
  assert.deepEqual(updated.caps, { renders: 3 });
  assert.equal("hash" in updated, false);

  const merged = store.updateKey("u_1", key.id, { caps: { images: 5 } });
  assert.deepEqual(merged.caps, { renders: 3, images: 5 });
  assert.equal(merged.publishAllowed, true);

  assert.equal(store.updateKey("u_2", key.id, { publishAllowed: false }), null);
  assert.equal(store.updateKey("u_1", "ak_missing", { publishAllowed: false }), null);

  store.revokeKey("u_1", key.id);
  assert.equal(store.updateKey("u_1", key.id, { publishAllowed: false }), null);
});

test("name is trimmed and bounded", () => {
  assert.throws(() => store.createKey("u_1", "   "), { message: "KEY_NAME" });
  assert.throws(() => store.createKey("u_1", "x".repeat(61)), { message: "KEY_NAME" });
  assert.throws(() => store.createKey("u_1", undefined), { message: "KEY_NAME" });
  const { key } = store.createKey("u_1", `  ${"y".repeat(60)}  `);
  assert.equal(key.name, "y".repeat(60));
});
