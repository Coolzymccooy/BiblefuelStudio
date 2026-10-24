import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { writeFileAtomic, writeJsonAtomic, writeFileAtomicAsync } from "./atomicFile.js";

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "atomic-"));

test("writes the whole file and leaves no temp file behind", () => {
  const dir = tmpDir();
  const file = path.join(dir, "store.json");
  writeJsonAtomic(file, { users: [{ id: 1 }] });
  writeJsonAtomic(file, { users: [{ id: 2 }] });
  assert.deepEqual(JSON.parse(fs.readFileSync(file, "utf8")), { users: [{ id: 2 }] });
  assert.deepEqual(fs.readdirSync(dir), ["store.json"]);
});

test("a write that cannot finish keeps what was there and cleans up", () => {
  const dir = tmpDir();
  const target = path.join(dir, "taken");
  fs.mkdirSync(target);
  fs.writeFileSync(path.join(target, "keep.txt"), "x");
  assert.throws(() => writeFileAtomic(target, "new"));
  assert.equal(fs.readFileSync(path.join(target, "keep.txt"), "utf8"), "x");
  assert.deepEqual(fs.readdirSync(dir), ["taken"]);
});

test("the async form writes the same way, and two at once both finish whole", async () => {
  const dir = tmpDir();
  const file = path.join(dir, "list.json");
  await Promise.all([
    writeFileAtomicAsync(file, JSON.stringify(["a".repeat(50_000)])),
    writeFileAtomicAsync(file, JSON.stringify(["b".repeat(50_000)])),
  ]);
  const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
  assert.ok(parsed[0] === "a".repeat(50_000) || parsed[0] === "b".repeat(50_000));
  assert.deepEqual(fs.readdirSync(dir), ["list.json"]);
});
