import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { listGumroadPacks, upsertGumroadPack, deleteGumroadPack } from "./gumroadStore.js";

function tmpDir() { return fs.mkdtempSync(path.join(os.tmpdir(), "gum-")); }

test("upsert creates, lists scoped to user, and caps", () => {
  const d = tmpDir();
  upsertGumroadPack(d, "u1", { freeTitle: "F1", paidTitle: "P1", freeMarkdown: "a", paidMarkdown: "b" });
  upsertGumroadPack(d, "u2", { freeTitle: "F2", paidTitle: "P2", freeMarkdown: "c", paidMarkdown: "d" });
  assert.equal(listGumroadPacks(d, "u1").length, 1);
  assert.equal(listGumroadPacks(d, "u1")[0].freeTitle, "F1");
  assert.equal(listGumroadPacks(d, "u2").length, 1);
});

test("upsert by (freeTitle+paidTitle) updates instead of duplicating, preserves createdAt", () => {
  const d = tmpDir();
  const a = upsertGumroadPack(d, "u1", { freeTitle: "F", paidTitle: "P", freeMarkdown: "v1", paidMarkdown: "x", now: "2020-01-01T00:00:00.000Z" });
  const b = upsertGumroadPack(d, "u1", { freeTitle: "F", paidTitle: "P", freeMarkdown: "v2", paidMarkdown: "x", now: "2020-02-02T00:00:00.000Z" });
  const list = listGumroadPacks(d, "u1");
  assert.equal(list.length, 1);
  assert.equal(list[0].freeMarkdown, "v2");
  assert.equal(b.id, a.id);
  assert.equal(list[0].createdAt, "2020-01-01T00:00:00.000Z");
  assert.equal(list[0].updatedAt, "2020-02-02T00:00:00.000Z");
});

test("delete removes only the caller's own record", () => {
  const d = tmpDir();
  const rec = upsertGumroadPack(d, "u1", { freeTitle: "F", paidTitle: "P", freeMarkdown: "a", paidMarkdown: "b" });
  assert.equal(deleteGumroadPack(d, "u2", rec.id), false);
  assert.equal(deleteGumroadPack(d, "u1", rec.id), true);
  assert.equal(listGumroadPacks(d, "u1").length, 0);
});

test("corrupt file reads as empty", () => {
  const d = tmpDir();
  fs.writeFileSync(path.join(d, "gumroad-history.json"), "{not json");
  assert.deepEqual(listGumroadPacks(d, "u1"), []);
});
