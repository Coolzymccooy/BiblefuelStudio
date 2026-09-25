import { test, describe } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { resolveThumbnail } from "./thumbnailPath.js";

function dirs() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "thumb-"));
  const globalOutputDir = path.join(base, "outputs");
  const ctxOutputDir = path.join(base, "data", "users", "u1", "outputs");
  fs.mkdirSync(path.join(globalOutputDir, "genImg", "p1"), { recursive: true });
  fs.mkdirSync(ctxOutputDir, { recursive: true });
  fs.writeFileSync(path.join(globalOutputDir, "genImg", "p1", "part-1.png"), "img");
  fs.writeFileSync(path.join(ctxOutputDir, "thumb.png"), "img");
  return { globalOutputDir, ctxOutputDir };
}

describe("resolveThumbnail", () => {
  test("resolves a /outputs/ alias inside the caller's own outputs", () => {
    const { globalOutputDir, ctxOutputDir } = dirs();
    const r = resolveThumbnail("/outputs/thumb.png", ctxOutputDir, globalOutputDir);
    assert.deepEqual(r, { ok: true, path: path.join(ctxOutputDir, "thumb.png") });
  });
  test("a non-admin tenant can use a genImg scene image from the GLOBAL outputs dir", () => {
    const { globalOutputDir, ctxOutputDir } = dirs();
    const r = resolveThumbnail("/outputs/genImg/p1/part-1.png", ctxOutputDir, globalOutputDir);
    assert.equal(r.ok, true);
    assert.equal(r.path, path.join(globalOutputDir, "genImg", "p1", "part-1.png"));
    assert.ok(fs.existsSync(r.path));
  });
  test("genImg alias cannot escape the genImg folder", () => {
    const { globalOutputDir, ctxOutputDir } = dirs();
    const r = resolveThumbnail("/outputs/genImg/../../secret.png", ctxOutputDir, globalOutputDir);
    assert.equal(r.ok, false);
    assert.match(r.error, /thumbnailPath/);
    const r2 = resolveThumbnail("/outputs/genImg/../other.png", ctxOutputDir, globalOutputDir);
    assert.equal(r2.ok, false, "even the global outputs root itself is off-limits via the genImg alias");
  });
  test("a plain /outputs/ alias never reaches the global outputs dir for a tenant", () => {
    const { globalOutputDir, ctxOutputDir } = dirs();
    const r = resolveThumbnail("/outputs/../../../outputs/genImg/p1/part-1.png", ctxOutputDir, globalOutputDir);
    assert.equal(r.ok, false);
  });
  test("rejects traversal and absolute paths outside the caller's outputs by name", () => {
    const { globalOutputDir, ctxOutputDir } = dirs();
    for (const bad of ["/outputs/../../etc/passwd", path.resolve(os.tmpdir(), "elsewhere.png"), "/etc/passwd"]) {
      const r = resolveThumbnail(bad, ctxOutputDir, globalOutputDir);
      assert.equal(r.ok, false, bad);
      assert.match(r.error, /thumbnailPath must point inside your outputs folder/);
    }
  });
  test("accepts an absolute path that is inside the caller's outputs, and a bare filename", () => {
    const { globalOutputDir, ctxOutputDir } = dirs();
    const abs = path.join(ctxOutputDir, "thumb.png");
    assert.deepEqual(resolveThumbnail(abs, ctxOutputDir, globalOutputDir), { ok: true, path: abs });
    assert.deepEqual(resolveThumbnail("thumb.png", ctxOutputDir, globalOutputDir), { ok: true, path: abs });
  });
  test("names an empty value", () => {
    const { globalOutputDir, ctxOutputDir } = dirs();
    assert.match(resolveThumbnail("", ctxOutputDir, globalOutputDir).error, /thumbnailPath/);
  });
});
